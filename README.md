# Lector OMR Docente v0.35

Mejoras tras primera prueba real con iPhone:

- Confirmación visible de cada captura: flash, miniatura, contador y vibración cuando está disponible.
- Pausa breve de botones para evitar dobles capturas accidentales.
- Detección de marcadores más estricta: posición esperada + geometría del cuadrilátero, para reducir falsos positivos causados por el QR.
- El OMR rechaza una hoja si aparecen cuatro candidatos pero su geometría no coincide con la plantilla.
- Los recortes de respuestas dudosas son más anchos e intentan incluir número de pregunta y toda la fila.
- Revisión muestra lectura, clave correcta, puntaje, habilidad/contenido e intensidades por alternativa.
- Cada incidencia permite desplegar la hoja completa para comparar.
