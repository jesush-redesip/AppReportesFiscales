import { defineStore } from 'pinia';
import { api } from '../lib/api';
import type { Almacen, Empresa, Moneda, Proveedor, Sucursal } from '../lib/types';

export const useCatalogosStore = defineStore('catalogos', {
  state: () => ({
    empresas: [] as Empresa[],
    almacenes: [] as Almacen[],
    monedas: [] as Moneda[],
    proveedores: [] as Proveedor[],
    sucursalesByEmpresa: {} as Record<string, Sucursal[]>,
    loaded: false,
  }),
  actions: {
    async loadBase() {
      if (this.loaded) return;
      const [empresas, almacenes, monedas, proveedores] = await Promise.all([
        api.get<Empresa[]>('/api/catalogos/empresas'),
        api.get<Almacen[]>('/api/catalogos/almacenes'),
        api.get<Moneda[]>('/api/catalogos/monedas'),
        api.get<Proveedor[]>('/api/catalogos/proveedores'),
      ]);
      this.empresas = empresas;
      this.almacenes = almacenes;
      this.monedas = monedas;
      this.proveedores = proveedores;
      this.loaded = true;
    },
    async loadSucursales(codEmpresa: string) {
      if (this.sucursalesByEmpresa[codEmpresa]) return this.sucursalesByEmpresa[codEmpresa];
      const sucursales = await api.get<Sucursal[]>('/api/catalogos/sucursales', { empresa: codEmpresa });
      this.sucursalesByEmpresa[codEmpresa] = sucursales;
      return sucursales;
    },
  },
});
