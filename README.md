# Lector OMR Docente v0.34

Primera cámara OMR experimental.

## Cámara en vivo
En Importar / Escanear:
1. Selecciona evaluación y forma.
2. Pulsa **Cámara experimental**.
3. La vista en vivo intenta detectar los cuatro marcadores exteriores cada ~650 ms.
4. Cuando detecta 4/4 habilita **Capturar hoja**.
5. La captura se agrega al lote y después se analiza con el mismo motor OMR ya validado.

La cámara en vivo (`getUserMedia`) requiere HTTPS o localhost. Al abrir el HTML directamente con `file://`, algunos navegadores la bloquean.

## Alternativa móvil
**Tomar foto con cámara** usa el selector de cámara del dispositivo (`capture="environment"`) y agrega la fotografía directamente al lote. Es útil para probar desde un HTML local mientras la PWA no esté publicada en HTTPS.
