# Cambios

Cada versión publicada con `scripts/publicar.ps1` agrega aquí su sección. Lo que esté
entre la versión instalada y la nueva se muestra en la pantalla Actualizaciones.

## 1.0.8 - 2026-10-09
- Nuevo modulo Detalle de Compras (exclusivo): compras por tienda, proveedor, documento y lineas, con retencion de IVA, IGTF, moneda Bs/USD y filtro por tipo de documento
- Detalle de Ventas: la consulta pasa a un procedimiento almacenado (mas rapido) y abre en USD por defecto
- Corrige la conversion de moneda en empresas cuya moneda principal es USD (BIGBEN)
- Los procedimientos del aplicativo se instalan y actualizan solos, respetando los que el cliente haya modificado

## 1.0.7 - 2026-10-08
- Nuevo modulo Detalle de Ventas (exclusivo: se activa en Modulos de la instalacion): ventas por tienda, dia, ticket y lineas, con grafica, moneda Bs/USD y filtros por grupo, promocion, articulo y clasificacion
- En desarrollo el .env puede vivir fuera de OneDrive (las instalaciones siguen usando backend\.env)

## 1.0.6 - 2026-10-06
- Cambiar de empresa sin cerrar sesion: clic en el nombre de la empresa de la barra superior
- Modo oscuro y claro (sigue a Windows hasta que el usuario elige)
- Inicio de sesion: boton para ver la clave y aviso de Bloq Mayus
- Leyenda de derechos reservados y version en el pie y en el inicio de sesion
- Barra superior mas compacta en laptops e iconos nuevos (engranaje para permisos, sol/luna para el tema)

## 1.0.5 - 2026-10-06
- Corrige la caida del servicio al descargar cualquier Excel
- Los Excel se descargan con el nombre del modulo y el rango de fechas
- Libro de Venta: contenido centrado, bordes completos en el encabezado y autofiltro en las 40 columnas
- Libro de Compra: NRO sin decimales, columnas de retencion e IGTF en su lugar, fecha de la retencion y resumen del pie corregido
- ARCV: encabezados Dia/Mes/Ano, el ano y los acumulados ya no se suman

## 1.0.4 - 2026-10-02
- Supervisor interno: el SUPERVISOR puede marcar a un usuario del cliente para que asigne permisos y configure el cierre
- Modulos de la instalacion: el SUPERVISOR activa o desactiva por grupo economico el Cierre de Caja y cada reporte
- El menu se actualiza con el acceso real del usuario al abrir la aplicacion

## 1.0.3 - 2026-10-02
- Retenciones de IVA: la vista previa muestra los totales
- Retenciones ISLR: el codigo de proveedor sin decimales y sin sumar, y el % de retencion sin sumar
- Resumen IGTF: numero de transacciones sin decimales
- Nuevo scripts\crear-servicio-manual.cmd para crear el servicio a mano con NSSM

## 1.0.2 - 2026-10-01
- Menu lateral que se muestra u oculta (boton del encabezado o Ctrl+B)
- El instalador genera JWT_SECRET automaticamente

## 1.0.1 - 2026-10-01
- Actualizador: GitHub como puente, sin Releases (descarga el zip de la rama main)
- Nueva pestaña Formas de pago del asiento en Cierre de Caja > Configuración

## 1.0.0 - 2026-10-01
- Primera versión publicada: libros de compra y venta, movimiento de inventario,
  retenciones de IVA e ISLR, resumen IGTF y cierre de caja.
