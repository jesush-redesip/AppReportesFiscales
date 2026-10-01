/**
 * Placeholder for values the legacy app read from a local `parametros.config` file
 * (`libreriascomunes.Util.cargarParametros`). Per the migration plan these belong in
 * an `app_config` table (see planned Knex migration) instead of a flat file — not yet
 * wired up, so the historical defaults are hardcoded here for the pilot module.
 */
export const reportConfig = {
  /** `Util.CODDTO` — retention concept code, default 3. Java key: CODRETENCIONIVA. */
  codRetencionConcepto: 3,
  /** `Util.AREA_EMPRESAS` — company scope filter, default "Z". Java key: INCLUIR_SERIE. */
  areaEmpresas: 'Z',
  /**
   * `Util.RETENCION_IVA` — forma de pago de retención IVA. Java key: CODFORMAPAGOIVA.
   * Verified directly against `FORMASPAGO` on EMPORIOP: CODFORMAPAGO '97' is the only
   * row described "RETENCION DE IVA CLIENTES" — '5' (the earlier guessed default) has
   * zero matching TESORERIA rows in this database.
   */
  codFormaPagoIva: '97',
};
