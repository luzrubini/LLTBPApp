# After the Black Parade

Archivo personal de shows de My Chemical Romance. Elegí un tour de `setlist.fm` para cargar todas sus fechas con venue, ciudad, país y setlist. Las canciones se cruzan con los álbumes de `LLTBP Tour.xlsx`; después marcás los shows a los que fuiste para dejar el sello de asistencia. Las fechas de ejemplo del Excel no se cargan automáticamente.

## Activar Google y Firestore

Podés usar el archivo sin iniciar sesión: agregá fechas, marcá asistencia y pegá los setlists; los cambios quedan guardados en el almacenamiento local de ese navegador. Para sincronizarlos entre dispositivos, configurá Firebase Authentication y Cloud Firestore e iniciá sesión con Google. La importación automática de giras desde setlist.fm necesita Firebase Functions, pero no requiere iniciar sesión.

1. Creá un proyecto en [Firebase Console](https://console.firebase.google.com/) y agregá una app web.
2. En **Authentication → Sign-in method**, habilitá **Google**.
3. En **Authentication → Settings → Authorized domains**, agregá el dominio de GitHub Pages, por ejemplo `tu-usuario.github.io`.
4. Creá la base de datos de **Cloud Firestore**. En **Rules**, publicá el contenido de `firestore.rules`.
5. Copiá `apiKey`, `authDomain`, `projectId` y `appId` de la configuración de la app web en `firebase-config.js`. La clave web se entrega al navegador; las reglas de Firestore son las que aíslan los datos de cada usuario.
6. En GitHub, abrí **Settings → Pages**, elegí **Deploy from a branch**, seleccioná la rama principal y la carpeta `/ (root)`.
7. Solicitá una API key gratuita para un proyecto no comercial en [setlist.fm](https://www.setlist.fm/settings/api).
8. Instalá Firebase CLI, iniciá sesión con `firebase login` y vinculá el proyecto con `firebase use --add`.
9. Ejecutá `npm --prefix functions install`, guardá la clave como secreto con `firebase functions:secrets:set SETLISTFM_API_KEY` y desplegá las funciones con `firebase deploy --only functions`.

El despliegue de Cloud Functions requiere el plan Blaze de Firebase y puede generar cargos según el uso. Revisá la facturación del proyecto antes de desplegar.

La página queda publicada en `https://tu-usuario.github.io/nombre-del-repo/`. No necesita build ni dependencias de Node. Las importaciones de Firebase se cargan desde CDN, así que la página necesita conexión a Internet.

## Lógica del Excel y setlists

- Los shows registrados agrupan 88 canciones en seis álbumes / bloques.
- La app obtiene la lista de tours de MCR y la cantidad de shows en cada tour desde setlist.fm.
- Al elegir un tour, importa todas las fechas que tengan una entrada de setlist.fm, incluyendo lugar, fecha, ciudad, país y canciones.
- Las canciones con fecha del Excel aparecen en el setlist de ese show y heredan el color asociado.
- Las canciones importadas se asignan a un álbum cuando coincide el título del catálogo. Las que no coinciden quedan visibles para que las revises.
- Marcá o desmarcá “I was there” en cada fecha; podés sumar nuevas fechas con su propio color.
- También podés pegar canciones, una por línea, para corregir el setlist de una fecha.

El importador busca coincidencias con el catálogo para incluir canciones en las estadísticas. Las líneas que no coincidan también se guardan y se ven en el setlist.

La importación usa los endpoints paginados de setlist.fm. Las fechas futuras o pasadas que todavía no tengan setlist publicado no aparecen en esa API. La clave `x-api-key` queda en un secreto de Firebase Functions y no en el JavaScript público de GitHub Pages.


## Importación de MCR y BTS (rama de la propuesta)

La interfaz compartida selecciona una gira automáticamente y carga sus fechas para evitar que el archivo quede vacío al entrar. Para que aparezcan shows reales, la función de Firebase debe estar desplegada y el secreto `SETLISTFM_API_KEY` debe existir.

- MCR: la función `listMcrTours` busca Black Parade 2025–2026.
- BTS: la función nueva `listBtsTours` busca setlists publicados de ARIRANG en 2026 y descarta fechas futuras.
- Después de revisar la propuesta, desplegá con `firebase deploy --only functions` desde la carpeta del proyecto Firebase.
- Las reglas nuevas de Firestore guardan los universos en `users/{uid}/archives/mcr` y `users/{uid}/archives/bts`. Publicá `firestore.rules` para permitir esa estructura.
- Si una función no está desplegada, el estado debajo del selector de gira indica el error. La importación automática requiere conexión y Firebase Functions; no se inventan fechas ni setlists.

La estética se comparte entre ambos universos: tarjetas suaves, fondos crema y pastel, bordes redondeados y paneles tipo diario. El contenido y los datos siguen separados.
