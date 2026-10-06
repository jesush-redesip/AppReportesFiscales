import { ref } from 'vue';

export type Tema = 'claro' | 'oscuro';

const CLAVE = 'tema';

function guardado(): Tema | null {
  try {
    const t = localStorage.getItem(CLAVE);
    return t === 'claro' || t === 'oscuro' ? t : null;
  } catch {
    return null;
  }
}

const sistema = window.matchMedia('(prefers-color-scheme: dark)');

/** El que ya aplicó index.html antes de dibujar (guardado o del sistema). */
const tema = ref<Tema>(document.documentElement.getAttribute('data-theme') === 'dark' ? 'oscuro' : 'claro');

function aplicar(t: Tema) {
  tema.value = t;
  document.documentElement.setAttribute('data-theme', t === 'oscuro' ? 'dark' : 'light');
}

// Mientras el usuario no elija uno, sigue al de Windows (también si cambia con la app abierta).
sistema.addEventListener('change', (e) => {
  if (!guardado()) aplicar(e.matches ? 'oscuro' : 'claro');
});

/** Tema claro / oscuro. La elección se recuerda en este navegador. */
export function useTema() {
  function alternar() {
    const nuevo: Tema = tema.value === 'oscuro' ? 'claro' : 'oscuro';
    aplicar(nuevo);
    try {
      localStorage.setItem(CLAVE, nuevo);
    } catch {
      /* sin almacenamiento: dura hasta recargar */
    }
  }
  return { tema, alternar };
}
