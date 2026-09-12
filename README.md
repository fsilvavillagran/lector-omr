# Lector OMR Docente v0.38

Objetivo de esta versión: diagnosticar y corregir con evidencia el posible desfase de filas del lector OMR.

Cambios:
- Cada hoja analizada incorpora **Ver mapa de lectura OMR**.
- El mapa superpone los puntos exactos donde el algoritmo está leyendo cada alternativa.
- Las preguntas ambiguas usan ahora un recorte **rectificado por perspectiva**, no un simple recorte rectangular de la foto.
- En ese recorte se dibuja la fila exacta y los cuatro puntos de lectura del algoritmo.
- Esto permite distinguir si el problema real está en la cuadrícula/calibración o solo en el recorte visual de revisión.
- Mantiene el flujo de cámara de v0.37.2 y la política de actualización de caché corregida.
