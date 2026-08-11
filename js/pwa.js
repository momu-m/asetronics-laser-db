// =====================================================================
// ALPA - PWA-Registrierung  (pwa.js)
// =====================================================================
//
// WAS MACHT DIESE DATEI?
//   Diese Datei ist der "Bootsrap" (Start-Helfer) fuer den Service
//   Worker (sw.js) und den Offline-Modus der Web-App.
//
//   Aufgaben:
//     1. Service Worker registrieren (damit sw.js laeuft).
//     2. Ein kleines "Offline"-Badge oben rechts anzeigen, sobald die
//        Internetverbindung weg ist.
//     3. (Vorbereitet) Top-Produkte vorab cachen fuer schnellen
//        Offline-Zugriff.
//
//   WICHTIG:  Diese Datei ist AUTONOM. Sie benoetigt KEINE andere
//             Datei (nicht app.js, nicht config.js). Sie kann auf
//             jeder Seite eingebunden werden.
//
//   EINBINDUNG:  In jeder HTML-Datei vor </body> einfuegen:
//                <script src="js/pwa.js"></script>
// =====================================================================


// ---------------------------------------------------------------------
// HILFSFKTION: Konsolenausgabe mit einheitlichem Prefix
// ---------------------------------------------------------------------
// So bleiben die Log-Zeilen sauber und man erkennt sofort, dass sie
// aus dem PWA-Modul kommen.
function pwaLog(nachricht) {
    console.log('[PWA] ' + nachricht);
}

function pwaWarn(nachricht) {
    console.warn('[PWA] ' + nachricht);
}


// ---------------------------------------------------------------------
// 1) registerServiceWorker()
// ---------------------------------------------------------------------
// Registriert den Service Worker (sw.js), damit er im Hintergrund
// laeuft. Ist in alten Browsern nicht verfuegbar -> dann ueberspringen
// wir stillschweigend (App laeuft dann normal, nur eben nicht offline).
// ---------------------------------------------------------------------
function registerServiceWorker() {
    // Sicherheitspruefung: Unterstuetzt dieser Browser Service Worker?
    if (!('serviceWorker' in navigator)) {
        pwaWarn('Service Worker wird von diesem Browser nicht unterstuetzt. Offline-Modus nicht verfuegbar.');
        return;
    }

    // Pfad zum Service Worker. Relativ zur aktuellen Seite angegeben,
    // damit es sowohl auf GitHub Pages (Unterordner) als auch lokal klappt.
    // Da pwa.js in /js/ liegt, muessen wir eine Ebene nach oben (../).
    const SW_PFAD = '../sw.js';

    navigator.serviceWorker.register(SW_PFAD)
        .then((registrierung) => {
            pwaLog('Service Worker erfolgreich registriert. Scope: ' + registrierung.scope);
        })
        .catch((fehler) => {
            pwaWarn('Registrierung des Service Workers fehlgeschlagen: ' + fehler.message);
        });
}


// ---------------------------------------------------------------------
// 2) showOfflineIndicator()
// ---------------------------------------------------------------------
// Zeigt einen kleinen roten Badge oben rechts an, wenn der Browser
// offline ist. Wird automatisch bei den online/offline-Events
// aktualisiert.
//
//   navigator.onLine  -> true:  Geraet hat Netzverbindung
//                    -> false: Geraet ist offline
//
//   HINWEIS: navigator.onLine ist nicht 100% zuverlaessig. "true"
//            bedeutet "Netzwerk-Interface aktiv", nicht zwingend
//            "Internet erreichbar". Fuer unsere Zwecke reicht das.
// ---------------------------------------------------------------------
function showOfflineIndicator() {

    const BADGE_ID = 'alpa-offline-badge';

    // Eventuell bereits vorhandenen Badge holen.
    let badge = document.getElementById(BADGE_ID);

    if (navigator.onLine) {
        // Online -> Badge entfernen, falls er existiert.
        if (badge) {
            badge.remove();
        }
        return;
    }

    // Offline -> Badge erstellen, falls er noch nicht existiert.
    if (!badge) {
        badge = document.createElement('div');
        badge.id = BADGE_ID;
        badge.textContent = 'Offline';

        // Styles direkt setzen, damit wir keine Abhaengigkeit zur
        // styles.css brauchen (autonome Datei).
        badge.style.position = 'fixed';
        badge.style.top = '12px';
        badge.style.right = '12px';
        badge.style.zIndex = '9999';
        badge.style.padding = '6px 14px';
        badge.style.borderRadius = '20px';
        badge.style.backgroundColor = '#C0392B';   // Asetronics-Rot-Ton
        badge.style.color = '#FFFFFF';
        badge.style.fontFamily = 'Arial, Helvetica, sans-serif';
        badge.style.fontSize = '13px';
        badge.style.fontWeight = '600';
        badge.style.boxShadow = '0 2px 6px rgba(0,0,0,0.25)';
        badge.style.userSelect = 'none';

        document.body.appendChild(badge);
        pwaLog('Offline-Modus erkannt. Badge eingeblendet.');
    }
}


// ---------------------------------------------------------------------
// 3) preCacheTopProdukte()
// ---------------------------------------------------------------------
// PLATZHALTER-FUNKTION.
//
// Langfristiges Ziel: Die 50 haeufigsten Produkte vom Supabase-Backend
// abrufen und in den Cache legen, damit sie auch offline schnell
// abrufbar sind.
//
// Aktuell macht sie noch nichts ausser einem Log-Eintrag, damit man
// weiss: Hier wird die Logik spaeter ergaenzt.
//
//   AUFRUF:  Diese Funktion kann spaeter z.B. nach erfolgreichem Login
//            aufgerufen werden:
//            window.preCacheTopProdukte();
// ---------------------------------------------------------------------
function preCacheTopProdukte() {
    pwaLog('preCacheTopProdukte() aufgerufen (noch nicht implementiert).');
    // TODO: Top-50 Produkte von Supabase holen und cachen.
}


// ---------------------------------------------------------------------
// 4) EVENT-LISTENER  (automatisch beim Laden)
// ---------------------------------------------------------------------
// Hier werden die Funktionen an die richtigen Browser-Events angehaengt.

// Sobald die Seite komplett geladen ist, den Service Worker starten.
// "load" wartet bis alle Ressourcen (Bilder, CSS) da sind, damit der
// SW-Registrierung nicht mitlegt.
window.addEventListener('load', registerServiceWorker);

// Wenn die Verbindung wiederhergestellt wird -> Badge aktualisieren.
window.addEventListener('online', function () {
    pwaLog('Verbindung wiederhergestellt. App ist online.');
    showOfflineIndicator();
});

// Wenn die Verbindung verloren geht -> Badge aktualisieren.
window.addEventListener('offline', function () {
    pwaLog('Verbindung verloren. App laeuft im Offline-Modus.');
    showOfflineIndicator();
});

// Beim ersten Laden einmal pruefen, falls die Seite bereits offline
// geoeffnet wurde.
document.addEventListener('DOMContentLoaded', showOfflineIndicator);


// ---------------------------------------------------------------------
// 5) FUNKTIONEN GLOBAL VERFUEGBAR MACHEN
// ---------------------------------------------------------------------
// Damit andere Skripte (z.B. app.js) die Funktionen aufrufen koennen:
//     window.preCacheTopProdukte();
//     window.registerServiceWorker();
//     window.showOfflineIndicator();
// ---------------------------------------------------------------------
window.registerServiceWorker = registerServiceWorker;
window.showOfflineIndicator = showOfflineIndicator;
window.preCacheTopProdukte = preCacheTopProdukte;
