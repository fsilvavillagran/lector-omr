# Lector OMR Docente v0.41

Versión orientada a estabilidad tras una prueba real de curso.

## Persistencia
- Se corrigió una causa concreta de pérdida de resultados: el mapa diagnóstico completo estaba quedando dentro de cada resultado de localStorage.
- Los resultados se compactan y las imágenes quedan fuera de localStorage.
- Se elimina la duplicación legacy de toda la base.
- Los errores de cuota ya no se silencian.
- El lote temporal se guarda en IndexedDB y puede restaurarse tras recargar la página.

## Revisión
- Una hoja que requiere reescaneo se puede **Descartar del lote** inmediatamente.
- Guardar resultados ya no elimina hojas pendientes: quedan en el lote.
- Una respuesta ambigua puede confirmarse tal como la leyó el algoritmo sin cambiarla primero.
- Se detectan **blancos dudosos** cercanos al umbral para que una marca tenue no pase silenciosamente como blanco.
- La corrección manual ahora apunta a la hoja exacta del lote, importante cuando se procesan muchas pruebas simultáneamente.

## Informes
- Se agrega distribución gráfica simple del rendimiento del curso.
- En vista curso aparece **Informes individuales del curso**, que imprime todos los informes individuales en un solo documento, cada estudiante en su propia página.
