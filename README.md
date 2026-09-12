# Lector OMR Docente v0.36

Nuevo flujo integrado de escaneo:

1. Las capturas de cámara quedan preparadas automáticamente; **Preparar archivos** se usa solo para JPG/PNG/PDF cargados.
2. **Analizar OMR** genera un borrador. Ya no traspasa resultados inmediatamente al curso.
3. Las anomalías aparecen en la misma pantalla de Importar / Escanear.
4. **Revisar anomalías** lleva al bloque de revisión del lote.
5. **Guardar cambios** traspasa al curso solo las hojas sin anomalías pendientes.
6. Si quedan datos sin revisar, la app advierte que esas hojas se perderán y no se traspasarán si se continúa.
7. Se eliminó la pestaña independiente “Revisión”.
8. Los recortes ambiguos tienen mucho más contexto vertical para que pueda verse el número impreso de la pregunta y detectar desplazamientos de fila.
