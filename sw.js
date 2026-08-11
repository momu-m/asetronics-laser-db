// =====================================================================
// ALPA - Service Worker (PWA-Offline-Modus)
// =====================================================================
//
// WAS MACHT DIESE DATEI?
//   Der Service Worker (SW) ist ein Skript, das im Hintergrund laeuft
//   und Anfragen der Web-App abfaengt. Er kann Dateien auf dem Geraet
//   zwischenspeichern (Cache), damit die App auch ohne Internet-
//   verbindung funktioniert.
//
//   Strategien in diesem SW:
//     1. Navigationen (Seitenaufrufe)    -> Network-First
//        Zuerst versucht er, die frische Seite aus dem Netz zu laden.
//        Schlaegt das fehl (kein Internet), laedt er die gespeicherte
//        index.html oder eine Offline-Seite.
//
//     2. Statische Assets (CSS, JS, ...) -> Cache-First
//        Zuerst schaut er im Cache nach. Nur wenn die Datei dort nicht
//        liegt, geht er ins Netz.
//
//     3. Supabase-API-Aufrufe            -> Network-Only (niemals cachen)
//        Damit keine veralteten Produktdaten angezeigt werden.
//
// WICHTIG:  Diese Datei wird WURZEL-RELATIV registriert (scope "./"),
//           damit sie alle Seiten unter /frontend/ steuern kann.
// =====================================================================


// ---------------------------------------------------------------------
// 1) KONFIGURATION
// ---------------------------------------------------------------------

// Name des Caches. Wenn sich Dateien aendern, muss die Versionsnummer
// hochgezaehlt werden (z.B. auf v2), damit alte Caches geloescht werden.
const CACHE_NAME = 'alpa-cache-v1';

// Liste aller Dateien, die beim Installieren vorgeladen (gecacht)
// werden sollen. Diese muessen alle erfolgreich ladbar sein, sonst
// schlaegt die Installation des Service Workers fehl.
const PRECACHE_URLS = [
    './',                                                  // Startseite
    './index.html',                                        // Login-Seite
    './produkte.html',                                     // Produktliste
    './detail.html',                                       // Detail-Ansicht
    './rechner.html',                                      // DMC-Rechner
    './anfragen.html',                                     // Anfrage-Formular
    './register.html',                                     // Registrierung
    './css/styles.css',                                    // Stylesheet
    './js/app.js',                                         // App-Logik
    './js/rechner.js',                                     // DMC-Rechner-Logik
    './config.js',                                         // Supabase-Konfig
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',  // Supabase-SDK
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'  // JSZip-Bibliothek
];

// URL der Offline-Seite. Darauf fallen wir zurueck, wenn weder Netz
// noch eine gecachte HTML-Seite erreichbar sind.
const OFFLINE_URL = './index.html';

// Erkennungszeichen fuer Supabase-Aufrufe. Alle API-Anfragen an
// Supabase enthalten diesen Text in der URL.
const SUPABASE_MARKER = 'supabase.co';


// ---------------------------------------------------------------------
// 2) INSTALL-EVENT  (wird einmal beim ersten Registrieren ausgeloest)
// ---------------------------------------------------------------------
// Hier wird der Cache angelegt und mit den PRECACHE_URLS gefuellt.
// skipWaiting() bewirkt, dass der neue SW sofort aktiv wird, ohne dass
// der Nutzer alle Tabs schliessen muss.
// ---------------------------------------------------------------------
self.addEventListener('install', (event) => {
    console.log('[SW] Install-Event: Lege Cache an und fuelle ihn vor.');

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // addAll laedt alle URLs herunter und speichert sie.
                // Wenn auch nur EINE URL fehlschlaegt, schlaegt das
                // gesamte addAll fehl.
                return cache.addAll(PRECACHE_URLS);
            })
            .then(() => {
                // Sofort aktiv werden, nicht auf Neustart warten.
                return self.skipWaiting();
            })
            .catch((fehler) => {
                console.error('[SW] Fehler beim Vorladen des Caches:', fehler);
            })
    );
});


// ---------------------------------------------------------------------
// 3) ACTIVATE-EVENT  (wird nach dem Install ausgeloest)
// ---------------------------------------------------------------------
// Hier werden alte Caches (mit anderen Namen) geloescht. Ausserdem
// uebernimmt der SW mit clients.claim() sofort die Kontrolle ueber
// alle offenen Seiten.
// ---------------------------------------------------------------------
self.addEventListener('activate', (event) => {
    console.log('[SW] Activate-Event: Bereinige alte Caches.');

    event.waitUntil(
        caches.keys()
            .then((cacheNamen) => {
                // Gehe durch alle vorhandenen Caches und loesche jeden,
                // der nicht dem aktuellen CACHE_NAME entspricht.
                return Promise.all(
                    cacheNamen.map((name) => {
                        if (name !== CACHE_NAME) {
                            console.log('[SW] Loesche alten Cache:', name);
                            return caches.delete(name);
                        }
                        return undefined;
                    })
                );
            })
            .then(() => {
                // Sofort Kontrolle uebernehmen.
                return self.clients.claim();
            })
    );
});


// ---------------------------------------------------------------------
// 4) FETCH-EVENT  (wird bei JEDER Anfrage der Seite ausgeloest)
// ---------------------------------------------------------------------
// Hier entscheiden wir pro Anfrage, welche Strategie zum Zug kommt.
// ---------------------------------------------------------------------
self.addEventListener('fetch', (event) => {

    const anfrage = event.request;

    // --- 4a) Supabase-API-Aufrufe: IMMER durchlassen (Network-Only) ---
    // Wir duerfen API-Antworten niemals cachen, sonst sieht der Nutzer
    // veraltete Produktdaten oder Login-Status.
    if (anfrage.url.includes(SUPABASE_MARKER)) {
        // fetch() leitet die Anfrage 1:1 weiter. Kein Cache-Eingriff.
        event.respondWith(fetch(anfrage));
        return;
    }

    // --- 4b) Navigationen (HTML-Seiten-Aufrufe): Network-First ---
    // mode === 'navigate' erkennt Dokumenten-Anfragen, also wenn der
    // Nutzer eine URL im Browser aufruft oder einen Link klickt.
    if (anfrage.mode === 'navigate') {
        event.respondWith(
            // Versuch 1: Frische Seite aus dem Netz holen.
            fetch(anfrage)
                .then((netzAntwort) => {
                    // Wenn erfolgreich, kopieren wir die Seite in den
                    // Cache, damit sie beim naechsten Offline-Besuch
                    // verfuegbar ist.
                    const antwortKopie = netzAntwort.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(anfrage, antwortKopie);
                    });
                    return netzAntwort;
                })
                .catch(() => {
                    // Versuch 2: Netz hat geklappt? Nein -> Cache.
                    return caches.match(anfrage)
                        .then((gecacht) => {
                            if (gecacht) {
                                return gecacht;
                            }
                            // Versuch 3: Auch nicht im Cache ->
                            //            Startseite als Notloesung.
                            return caches.match(OFFLINE_URL);
                        });
                })
        );
        return;
    }

    // --- 4c) Alle anderen Anfragen (CSS, JS, Bilder, ...): Cache-First ---
    // Erst im Cache nachsehen. Nur wenn dort nichts liegt, laden wir
    // frisch aus dem Netz und legen es fuer das naechste Mal ab.
    event.respondWith(
        caches.match(anfrage)
            .then((gecacht) => {
                if (gecacht) {
                    // Gefunden im Cache -> zurueckgeben.
                    return gecacht;
                }
                // Nicht im Cache -> aus dem Netz holen.
                return fetch(anfrage)
                    .then((netzAntwort) => {
                        // Nur gueltige und same-origin Antworten cachen.
                        // (Cross-Origin wie CDNs duerfen zwar geladen
                        // werden, aber das Cachen ist dort eingeschraenkt.)
                        if (!netzAntwort || netzAntwort.status !== 200) {
                            return netzAntwort;
                        }
                        const antwortKopie = netzAntwort.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(anfrage, antwortKopie);
                        });
                        return netzAntwort;
                    })
                    .catch((fehler) => {
                        console.warn('[SW] Anfrage fehlgeschlagen (offline?):', anfrage.url);
                        throw fehler;
                    });
            })
    );
});
