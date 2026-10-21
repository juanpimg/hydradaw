/**
 * I1: plantilla por defecto del editor de plugins (PluginRackModal).
 *
 * Vive en su propio módulo para no duplicar la cadena entre el editor y los
 * tests: el test `src/tests/customPluginTemplate.test.ts` registra ESTA
 * cadena exacta en el sandbox real, y el check P9 de producción compila el
 * contenido por defecto del textarea (que es esta misma cadena).
 *
 * API del sandbox puente (ver ayuda del editor y `public/sandbox.js`): el
 * proxy expone solo las 8 factorías allowlisted más `connect`/`disconnect` y
 * asignación de parámetros. En particular NO existe `context.currentTime` —
 * la plantilla anterior lo usaba en `setTargetAtTime(val, context.currentTime,
 * 0.02)` y el registro fallaba en la sonda con "argumento no finito". Los
 * parámetros se fijan por asignación directa (`.value =`), que el proxy
 * registra como op `setValue`.
 */
export const CUSTOM_PLUGIN_TEMPLATE: string = `// Plantilla de Plugin Local VST / WAM en JavaScript
const customPlugin = {
  id: 'custom_filter_' + Date.now(),
  name: 'Filtro Resonante Personalizado',
  category: 'custom',
  description: 'Filtro paso bajo analógico con resonancia Q',
  parameters: [
    { id: 'cutoff', name: 'Cutoff', min: 100, max: 12000, step: 50, defaultValue: 2500, unit: 'Hz' },
    { id: 'resonance', name: 'Q', min: 0.5, max: 12, step: 0.2, defaultValue: 3.0 }
  ],
  createDSPNode: (context, params) => {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = params.cutoff ?? 2500;
    filter.Q.value = params.resonance ?? 3.0;
    return {
      inputNode: filter,
      outputNode: filter,
      updateParameter: (id, val) => {
        if (id === 'cutoff') filter.frequency.value = val;
        if (id === 'resonance') filter.Q.value = val;
      }
    };
  }
};`;
