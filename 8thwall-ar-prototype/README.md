# Prototipo 8th Wall AR

Prototipo nuevo e independiente para validar este flujo:

- deteccion inicial con Image Target
- estabilizacion de varias mediciones
- colocacion de la escultura con offset configurable
- permanencia del objeto en coordenadas de mundo con SLAM
- recalibracion suave si el target reaparece
- diagnostico visible para medir estabilidad y drift

## Estado de viabilidad confirmado

El 26 de agosto de 2026 la documentacion oficial de 8th Wall sigue indicando:

- soporte de `Image Targets` y `World Tracking (SLAM)` en el engine
- `scale: 'absolute'` para trabajar en metros
- integracion oficial con `three.js`
- distribucion actual del motor mediante `@8thwall/engine-binary` o descarga directa
- licencia binaria cerrada para el motor con SLAM, mientras el resto del stack ya es abierto

Importante:

- la plataforma alojada de 8th Wall se retiro el 28 de febrero de 2026
- los proyectos nuevos ahora deben montarse en local y autohospedarse
- el binario con SLAM sigue siendo utilizable, pero bajo licencia binaria limitada

## Estructura

- `index.html`: carga el binario oficial de 8th Wall y arranca la app
- `src/main.ts`: logica de tracking, estabilizacion, world anchoring y UI
- `src/styles.css`: HUD y panel de diagnostico
- `public/image-targets/`: aqui ira el target 8th Wall generado en JSON

## Scripts

```bash
pnpm dev
pnpm build
pnpm preview
```

## Probar en movil

1. Ejecuta `pnpm dev`
2. Expone `https` con `ngrok http 8080` o un tunel equivalente
3. Abre la URL HTTPS en Safari de iPhone o Chrome de Android
4. Imprime o muestra la imagen usada como target
5. Enfoca el target y mueve el telefono adelante y atras suavemente
6. Espera a que el estado cambie a anclado
7. Aparta el target del encuadre y desplaza el movil hacia la escultura

## Ajustes rapidos

En `src/main.ts`:

- `distanceOptionsMeters`: pruebas a `0.5`, `1`, `2`, `3`
- `forwardAxisFromTarget`: direccion del offset respecto al target
- `sculptureHeightOffsetMeters`: elevacion vertical de la escultura
- `targetPhysicalWidthMeters` y `targetPhysicalHeightMeters`: referencia real del soporte fisico
- `stabilizationSamplesNeeded`: numero de muestras antes de fijar referencia
- `recalibrationAlpha`: fuerza de recalibracion cuando el target reaparece

## Siguiente paso recomendado

Sustituir la geometria de prueba por el modelo final de la escultura y ajustar el vector de offset exacto en el espacio real de instalacion.
