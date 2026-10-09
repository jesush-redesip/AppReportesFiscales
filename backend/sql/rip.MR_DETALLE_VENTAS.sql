-- VERSION: 2
/* =============================================================================
   rip.MR_DETALLE_VENTAS - Detalle de Ventas (Aplicativo Web, modulo "detalle-ventas")
   -----------------------------------------------------------------------------
   Tablero de ventas por niveles. Un solo procedimiento para que el calculo sea el
   mismo en todos (los totales de un nivel son la suma del siguiente):

     @NIVEL = 'TIENDAS'  ventas por tienda (2 primeros caracteres de la serie)
              'DIAS'     por dia, de @TIENDA
              'TICKETS'  tickets (albaranes) de @TIENDA en @FECHA
              'LINEAS'   lineas de un ticket (@NUMSERIE, @NUMALBARAN, @N)

   Devuelve DOS conjuntos de resultados: las filas y una fila de totales
   (margen, ticket promedio y unidades por ticket ponderados, no sumados).

   CALCULO
     MONTO = TOTAL de la linea menos el descuento comercial de la cabecera.
     IVA   = MONTO x %IVA de la linea.        COSTO = COSTE x unidades.
     IGTF  = TOTALCARGOSDTOS de la cabecera (una vez por ticket).
     Moneda: todo en @MONEDA (ver el sentido de la cotizacion mas abajo). Importes del documento x (1 si ya esta en esa moneda,
     si no FACTORMONEDA x cotizacion del dia); el COSTE esta en la moneda principal
     -> x cotizacion del dia de @MONEDA.
     Se excluyen las series que empiezan por Z.

   FILTROS (NULL = sin filtro). Se aplican a las lineas: un ticket cuenta si tiene al
   menos una linea que cumple, y su IGTF entra entero.
     @GRUPO      serie de 1 caracter (grupo de empresas)
     @PROMOCION  IDPROMOCION (ALBVENTALINPROMOCIONES)
     @REFS       referencias (REFPROVEEDOR) separadas por coma
     @DPTO > @SECCION > @FAMILIA > @SUBFAMILIA   (cada uno solo con el anterior)
     @MARCA > @LINEA

   INSTALACION
     El Aplicativo Web lo crea solo en cada base la primera vez que se usa el
     modulo. Cuando trae una version nueva (linea "-- VERSION" de arriba) lo
     actualiza SOLO si nadie lo modifico desde que lo instalo; si se ajusto para un
     cliente, el ajuste se respeta. Para reinstalar la version original, ejecutar este script completo
     (crea el procedimiento si no existe y lo reemplaza si existe).
     Compatible con SQL Server 2012 o superior (sin STRING_SPLIT ni CREATE OR ALTER).
   ============================================================================= */
IF SCHEMA_ID('rip') IS NULL EXEC('CREATE SCHEMA rip');
GO
IF OBJECT_ID('rip.MR_DETALLE_VENTAS', 'P') IS NULL
  EXEC('CREATE PROCEDURE rip.MR_DETALLE_VENTAS AS RETURN 0');
GO
ALTER PROCEDURE rip.MR_DETALLE_VENTAS
  @NIVEL      VARCHAR(10),
  @DESDE      DATE,
  @HASTA      DATE,
  @MONEDA     INT,
  @GRUPO      NVARCHAR(1)   = NULL,
  @PROMOCION  INT           = NULL,
  @REFS       NVARCHAR(MAX) = NULL,
  @DPTO       INT           = NULL,
  @SECCION    INT           = NULL,
  @FAMILIA    INT           = NULL,
  @SUBFAMILIA INT           = NULL,
  @MARCA      INT           = NULL,
  @LINEA      INT           = NULL,
  @TIENDA     NVARCHAR(2)   = NULL,
  @FECHA      DATE          = NULL,
  @NUMSERIE   NVARCHAR(4)   = NULL,
  @NUMALBARAN INT           = NULL,
  @N          NCHAR(1)      = NULL
AS
BEGIN
  SET NOCOUNT ON;

  -- Sentido de la cotizacion de @MONEDA (MONEDAS.NUMERADOR):
  --   'F' (p. ej. Bs en una empresa con principal USD): COTIZACION = unidades de @MONEDA
  --        por 1 de la principal  -> principal x COTIZACION.
  --   'T' (p. ej. USD en una empresa con principal Bs): COTIZACION = unidades de la
  --        principal por 1 de @MONEDA -> principal / COTIZACION.
  -- Si @MONEDA es la principal, el factor es 1. (Comprobado con FACTORMONEDA de los
  -- documentos: en 'F' es 1/COTIZACION y en 'T' es igual a COTIZACION.)
  DECLARE @NUMERADOR NCHAR(1) = 'F', @ES_PRINCIPAL BIT = 0;
  IF COL_LENGTH('dbo.MONEDAS', 'NUMERADOR') IS NOT NULL
    EXEC sys.sp_executesql N'SELECT @N = NUMERADOR FROM dbo.MONEDAS WHERE CODMONEDA = @M',
      N'@N NCHAR(1) OUTPUT, @M INT', @N = @NUMERADOR OUTPUT, @M = @MONEDA;
  SELECT @ES_PRINCIPAL = CASE WHEN PRINCIPAL = 'T' THEN 1 ELSE 0 END FROM dbo.MONEDAS WHERE CODMONEDA = @MONEDA;

  IF @NIVEL NOT IN ('TIENDAS', 'DIAS', 'TICKETS', 'LINEAS')
  BEGIN RAISERROR('@NIVEL debe ser TIENDAS, DIAS, TICKETS o LINEAS.', 16, 1); RETURN; END
  IF @NIVEL IN ('DIAS', 'TICKETS') AND @TIENDA IS NULL
  BEGIN RAISERROR('Falta @TIENDA.', 16, 1); RETURN; END
  IF @NIVEL = 'TICKETS'
  BEGIN
    IF @FECHA IS NULL BEGIN RAISERROR('Falta @FECHA.', 16, 1); RETURN; END
    SELECT @DESDE = @FECHA, @HASTA = @FECHA;
  END
  IF @NIVEL = 'LINEAS' AND (@NUMSERIE IS NULL OR @NUMALBARAN IS NULL OR @N IS NULL)
  BEGIN RAISERROR('Faltan @NUMSERIE, @NUMALBARAN y @N.', 16, 1); RETURN; END

  -- Jerarquia: cada nivel solo cuenta si viene el anterior.
  IF @DPTO IS NULL SET @SECCION = NULL;
  IF @SECCION IS NULL SET @FAMILIA = NULL;
  IF @FAMILIA IS NULL SET @SUBFAMILIA = NULL;
  IF @MARCA IS NULL SET @LINEA = NULL;

  -- Referencias separadas por coma (con XML: sirve en cualquier nivel de compatibilidad).
  DECLARE @R TABLE (REF NVARCHAR(50) COLLATE DATABASE_DEFAULT PRIMARY KEY);
  IF NULLIF(LTRIM(RTRIM(@REFS)), '') IS NOT NULL
    INSERT INTO @R (REF)
    SELECT DISTINCT LTRIM(RTRIM(X.V.value('.', 'NVARCHAR(50)')))
    FROM (SELECT CAST('<r>' + REPLACE((SELECT @REFS FOR XML PATH('')), ',', '</r><r>') + '</r>' AS XML) AS D) T
    CROSS APPLY T.D.nodes('/r') X(V)
    WHERE LTRIM(RTRIM(X.V.value('.', 'NVARCHAR(50)'))) <> '';
  DECLARE @HAY_REFS BIT = CASE WHEN EXISTS (SELECT 1 FROM @R) THEN 1 ELSE 0 END;

  -- ---------------------------------------------------------------------------
  -- LINEAS de un ticket
  -- ---------------------------------------------------------------------------
  IF @NIVEL = 'LINEAS'
  BEGIN
    DECLARE @COT FLOAT, @FD FLOAT, @CODMONEDA_DOC INT, @FACTOR_DOC FLOAT;
    SELECT @COT = CASE WHEN @ES_PRINCIPAL = 1 THEN 1.0 WHEN @NUMERADOR = 'T' THEN 1.0 / NULLIF(dbo.F_GET_COTIZACION(C.FECHA, @MONEDA), 0) ELSE dbo.F_GET_COTIZACION(C.FECHA, @MONEDA) END,
           @CODMONEDA_DOC = C.CODMONEDA, @FACTOR_DOC = C.FACTORMONEDA
    FROM ALBVENTACAB C WITH (NOLOCK)
    WHERE C.NUMSERIE = @NUMSERIE AND C.NUMALBARAN = @NUMALBARAN AND C.N = @N;
    SET @FD = CASE WHEN @CODMONEDA_DOC = @MONEDA THEN 1.0 ELSE @FACTOR_DOC * @COT END;

    SELECT L.NUMLIN,
           ISNULL(VC.NOMVENDEDOR, '') AS CAJERO,
           ISNULL(VL.NOMVENDEDOR, '') AS VENDEDOR,
           ART.REFPROVEEDOR, ART.DESCRIPCION, L.TALLA, L.COLOR,
           L.UNIDADESTOTAL AS UNIDADES,
           ROUND(L.PRECIO * @FD, 2) AS PRECIO,
           ISNULL(L.DTO, 0) AS DTO_LINEA,
           ISNULL(C.DTOCOMERCIAL, 0) AS DTO_FACTURA,
           L.TOTAL * (1 - ISNULL(C.DTOCOMERCIAL, 0) / 100.0) * @FD AS MONTO,
           L.TOTAL * (1 - ISNULL(C.DTOCOMERCIAL, 0) / 100.0) * ISNULL(L.IVA, 0) / 100.0 * @FD AS IVA,
           ISNULL(L.COSTE, 0) * L.UNIDADESTOTAL * @COT AS COSTO
    INTO #LIN
    FROM ALBVENTACAB C WITH (NOLOCK)
    JOIN ALBVENTALIN L WITH (NOLOCK) ON L.NUMSERIE = C.NUMSERIE AND L.NUMALBARAN = C.NUMALBARAN AND L.N = C.N
    JOIN ARTICULOS ART WITH (NOLOCK) ON ART.CODARTICULO = L.CODARTICULO
    LEFT JOIN VENDEDORES VC WITH (NOLOCK) ON VC.CODVENDEDOR = C.CODVENDEDOR
    LEFT JOIN VENDEDORES VL WITH (NOLOCK) ON VL.CODVENDEDOR = L.CODVENDEDOR
    WHERE C.NUMSERIE = @NUMSERIE AND C.NUMALBARAN = @NUMALBARAN AND C.N = @N
      AND C.FECHA BETWEEN @DESDE AND @HASTA
      AND (@GRUPO IS NULL OR C.NUMSERIE LIKE @GRUPO + '%')
      AND (@PROMOCION IS NULL OR EXISTS (
            SELECT 1 FROM ALBVENTALINPROMOCIONES PR WITH (NOLOCK)
            WHERE PR.NUMSERIE = L.NUMSERIE AND PR.NUMALBARAN = L.NUMALBARAN AND PR.N = L.N
              AND PR.NUMLIN = L.NUMLIN AND PR.IDPROMOCION = @PROMOCION))
      AND (@HAY_REFS = 0 OR ART.REFPROVEEDOR COLLATE DATABASE_DEFAULT IN (SELECT REF FROM @R))
      AND (@DPTO IS NULL OR ART.DPTO = @DPTO)
      AND (@SECCION IS NULL OR ART.SECCION = @SECCION)
      AND (@FAMILIA IS NULL OR ART.FAMILIA = @FAMILIA)
      AND (@SUBFAMILIA IS NULL OR ART.SUBFAMILIA = @SUBFAMILIA)
      AND (@MARCA IS NULL OR ART.MARCA = @MARCA)
      AND (@LINEA IS NULL OR ART.LINEA = @LINEA);

    SELECT NUMLIN, CAJERO, VENDEDOR, REFPROVEEDOR, DESCRIPCION, TALLA, COLOR, UNIDADES, PRECIO, DTO_LINEA, DTO_FACTURA,
           ROUND(MONTO, 2) AS MONTO, ROUND(IVA, 2) AS IVA, ROUND(COSTO, 2) AS COSTO,
           ROUND(MONTO - COSTO, 2) AS BENEFICIO,
           ROUND((MONTO - COSTO) * 100.0 / NULLIF(MONTO, 0), 2) AS MARGEN
    FROM #LIN ORDER BY NUMLIN;

    SELECT SUM(UNIDADES) AS UNIDADES, ROUND(SUM(MONTO), 2) AS MONTO, ROUND(SUM(IVA), 2) AS IVA,
           ROUND(SUM(COSTO), 2) AS COSTO, ROUND(SUM(MONTO) - SUM(COSTO), 2) AS BENEFICIO,
           ROUND((SUM(MONTO) - SUM(COSTO)) * 100.0 / NULLIF(SUM(MONTO), 0), 2) AS MARGEN
    FROM #LIN;
    RETURN;
  END

  -- ---------------------------------------------------------------------------
  -- TIENDAS / DIAS / TICKETS: tickets con importes convertidos (#TIC)
  -- ---------------------------------------------------------------------------
  -- Cotizacion una vez por dia (como funcion en linea se llamaria en cada linea).
  SELECT F.FECHA, CASE WHEN @ES_PRINCIPAL = 1 THEN 1.0 WHEN @NUMERADOR = 'T' THEN 1.0 / NULLIF(dbo.F_GET_COTIZACION(F.FECHA, @MONEDA), 0) ELSE dbo.F_GET_COTIZACION(F.FECHA, @MONEDA) END AS COT
  INTO #COT
  FROM (SELECT DISTINCT FECHA FROM ALBVENTACAB WITH (NOLOCK)
        WHERE FECHA BETWEEN @DESDE AND @HASTA AND NUMSERIE NOT LIKE 'Z%') F;

  SELECT C.NUMSERIE, C.NUMALBARAN, C.N, C.FECHA,
         SUM(L.UNIDADESTOTAL) AS UNIDADES,
         SUM(L.TOTAL * (1 - ISNULL(C.DTOCOMERCIAL, 0) / 100.0) * FX.FD) AS MONTO,
         SUM(L.TOTAL * (1 - ISNULL(C.DTOCOMERCIAL, 0) / 100.0) * ISNULL(L.IVA, 0) / 100.0 * FX.FD) AS IVA,
         SUM(ISNULL(L.COSTE, 0) * L.UNIDADESTOTAL * X.COT) AS COSTO,
         MAX(ISNULL(C.TOTALCARGOSDTOS, 0) * FX.FD) AS IGTF
  INTO #TIC
  FROM ALBVENTACAB C WITH (NOLOCK)
  JOIN ALBVENTALIN L WITH (NOLOCK) ON L.NUMSERIE = C.NUMSERIE AND L.NUMALBARAN = C.NUMALBARAN AND L.N = C.N
  JOIN ARTICULOS ART WITH (NOLOCK) ON ART.CODARTICULO = L.CODARTICULO
  JOIN #COT X ON X.FECHA = C.FECHA
  CROSS APPLY (SELECT CASE WHEN C.CODMONEDA = @MONEDA THEN 1.0 ELSE C.FACTORMONEDA * X.COT END AS FD) FX
  WHERE C.FECHA BETWEEN @DESDE AND @HASTA
    AND C.NUMSERIE NOT LIKE 'Z%'
    AND (@TIENDA IS NULL OR C.NUMSERIE LIKE @TIENDA + '%')
    AND (@GRUPO IS NULL OR C.NUMSERIE LIKE @GRUPO + '%')
    AND (@PROMOCION IS NULL OR EXISTS (
          SELECT 1 FROM ALBVENTALINPROMOCIONES PR WITH (NOLOCK)
          WHERE PR.NUMSERIE = L.NUMSERIE AND PR.NUMALBARAN = L.NUMALBARAN AND PR.N = L.N
            AND PR.NUMLIN = L.NUMLIN AND PR.IDPROMOCION = @PROMOCION))
    AND (@HAY_REFS = 0 OR ART.REFPROVEEDOR COLLATE DATABASE_DEFAULT IN (SELECT REF FROM @R))
    AND (@DPTO IS NULL OR ART.DPTO = @DPTO)
    AND (@SECCION IS NULL OR ART.SECCION = @SECCION)
    AND (@FAMILIA IS NULL OR ART.FAMILIA = @FAMILIA)
    AND (@SUBFAMILIA IS NULL OR ART.SUBFAMILIA = @SUBFAMILIA)
    AND (@MARCA IS NULL OR ART.MARCA = @MARCA)
    AND (@LINEA IS NULL OR ART.LINEA = @LINEA)
  GROUP BY C.NUMSERIE, C.NUMALBARAN, C.N, C.FECHA
  OPTION (RECOMPILE);

  IF @NIVEL = 'TIENDAS'
    SELECT G.TIENDA, LTRIM(RTRIM(ISNULL(S.DESCRIPCION, G.TIENDA))) AS DESCRIPCION,
           G.MONTO, G.IVA, G.IGTF, G.TOTAL, G.COSTO, G.BENEFICIO, G.MARGEN, G.UNIDADES, G.TICKETS,
           G.PROMEDIO, G.UPF, G.MONTO_UNIDAD
    FROM (
      SELECT SUBSTRING(T.NUMSERIE, 1, 2) AS TIENDA,
             ROUND(SUM(T.MONTO), 2) AS MONTO, ROUND(SUM(T.IVA), 2) AS IVA, ROUND(SUM(T.IGTF), 2) AS IGTF,
             ROUND(SUM(T.MONTO + T.IVA + T.IGTF), 2) AS TOTAL, ROUND(SUM(T.COSTO), 2) AS COSTO,
             ROUND(SUM(T.MONTO) - SUM(T.COSTO), 2) AS BENEFICIO,
             ROUND((SUM(T.MONTO) - SUM(T.COSTO)) * 100.0 / NULLIF(SUM(T.MONTO), 0), 2) AS MARGEN,
             SUM(T.UNIDADES) AS UNIDADES, COUNT(*) AS TICKETS,
             ROUND(SUM(T.MONTO + T.IVA + T.IGTF) / NULLIF(COUNT(*), 0), 2) AS PROMEDIO,
             ROUND(SUM(T.UNIDADES) / NULLIF(COUNT(*), 0), 2) AS UPF,
             ROUND(SUM(T.MONTO) / NULLIF(SUM(T.UNIDADES), 0), 2) AS MONTO_UNIDAD
      FROM #TIC T GROUP BY SUBSTRING(T.NUMSERIE, 1, 2)
    ) G
    LEFT JOIN SERIES S WITH (NOLOCK) ON S.SERIE = G.TIENDA
    ORDER BY DESCRIPCION;

  ELSE IF @NIVEL = 'DIAS'
    SELECT CONVERT(VARCHAR(10), T.FECHA, 120) AS FECHA,
           ROUND(SUM(T.MONTO), 2) AS MONTO, ROUND(SUM(T.IVA), 2) AS IVA, ROUND(SUM(T.IGTF), 2) AS IGTF,
           ROUND(SUM(T.MONTO + T.IVA + T.IGTF), 2) AS TOTAL, ROUND(SUM(T.COSTO), 2) AS COSTO,
           ROUND(SUM(T.MONTO) - SUM(T.COSTO), 2) AS BENEFICIO,
           ROUND((SUM(T.MONTO) - SUM(T.COSTO)) * 100.0 / NULLIF(SUM(T.MONTO), 0), 2) AS MARGEN,
           SUM(T.UNIDADES) AS UNIDADES, COUNT(*) AS TICKETS,
           ROUND(SUM(T.MONTO + T.IVA + T.IGTF) / NULLIF(COUNT(*), 0), 2) AS PROMEDIO,
           ROUND(SUM(T.UNIDADES) / NULLIF(COUNT(*), 0), 2) AS UPF,
           ROUND(SUM(T.MONTO) / NULLIF(SUM(T.UNIDADES), 0), 2) AS MONTO_UNIDAD
    FROM #TIC T GROUP BY T.FECHA ORDER BY T.FECHA;

  ELSE -- TICKETS
    SELECT T.NUMSERIE, T.NUMALBARAN, T.N,
           C.CAJA,
           CONVERT(VARCHAR(5), C.HORA, 108) AS HORA,
           CASE WHEN SUBSTRING(T.NUMSERIE, 4, 1) = 'N' OR T.MONTO < 0 THEN 'Nota de crédito' ELSE 'Factura' END AS TIPO,
           CASE WHEN C.NUMFAC IS NULL OR C.NUMFAC = 0 THEN T.NUMSERIE + '-' + CAST(T.NUMALBARAN AS VARCHAR(12))
                ELSE ISNULL(C.NUMSERIEFAC, '') + '-' + CAST(C.NUMFAC AS VARCHAR(12)) END AS DOCUMENTO,
           ISNULL(CL.NFISCAL, '') AS NFISCAL,
           CL.ZFISCAL,
           -- ICG guarda '00000000000' cuando no afecta a ninguna factura.
           CASE WHEN REPLACE(ISNULL(CL.FACAFECTA, ''), '0', '') = '' THEN '' ELSE CL.FACAFECTA END AS FACAFECTA,
           ROUND(T.MONTO, 2) AS MONTO, ROUND(T.IVA, 2) AS IVA, ROUND(T.IGTF, 2) AS IGTF,
           ROUND(T.MONTO + T.IVA + T.IGTF, 2) AS TOTAL, ROUND(T.COSTO, 2) AS COSTO,
           ROUND(T.MONTO - T.COSTO, 2) AS BENEFICIO,
           ROUND((T.MONTO - T.COSTO) * 100.0 / NULLIF(T.MONTO, 0), 2) AS MARGEN,
           T.UNIDADES
    FROM #TIC T
    JOIN ALBVENTACAB C WITH (NOLOCK) ON C.NUMSERIE = T.NUMSERIE AND C.NUMALBARAN = T.NUMALBARAN AND C.N = T.N
    LEFT JOIN FACTURASVENTACAMPOSLIBRES CL WITH (NOLOCK)
      ON CL.NUMSERIE = C.NUMSERIEFAC AND CL.NUMFACTURA = C.NUMFAC AND CL.N = C.NFAC
    ORDER BY C.HORA, T.NUMSERIE, T.NUMALBARAN;

  -- Totales del nivel (ponderados).
  SELECT ROUND(SUM(T.MONTO), 2) AS MONTO, ROUND(SUM(T.IVA), 2) AS IVA, ROUND(SUM(T.IGTF), 2) AS IGTF,
         ROUND(SUM(T.MONTO + T.IVA + T.IGTF), 2) AS TOTAL, ROUND(SUM(T.COSTO), 2) AS COSTO,
         ROUND(SUM(T.MONTO) - SUM(T.COSTO), 2) AS BENEFICIO,
         ROUND((SUM(T.MONTO) - SUM(T.COSTO)) * 100.0 / NULLIF(SUM(T.MONTO), 0), 2) AS MARGEN,
         SUM(T.UNIDADES) AS UNIDADES, COUNT(*) AS TICKETS,
         ROUND(SUM(T.MONTO + T.IVA + T.IGTF) / NULLIF(COUNT(*), 0), 2) AS PROMEDIO,
         ROUND(SUM(T.UNIDADES) / NULLIF(COUNT(*), 0), 2) AS UPF,
         ROUND(SUM(T.MONTO) / NULLIF(SUM(T.UNIDADES), 0), 2) AS MONTO_UNIDAD
  FROM #TIC T;
END
GO
