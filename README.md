# Lector OMR Docente v0.37.2

Parche de actualización/caché para GitHub Pages y PWA.

- Corrige el modal “Agregar estudiante”.
- Cambia el Service Worker a estrategia network-first para navegación.
- Fuerza la consulta de una versión nueva de `app.js`.
- El registro del Service Worker llama a `update()` y usa `sw.js?v=0.37.2`.
- Esto evita que una versión antigua quede retenida indefinidamente por el caché de la PWA.

Si un iPhone quedó atrapado en v0.37, puede ser necesario borrar una vez los datos del sitio de GitHub Pages y volver a abrirlo.
