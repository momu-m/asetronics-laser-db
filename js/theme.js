// =====================================================================
// ALPA - Dark-Mode / Theme-Umschalter (theme.js)
// =====================================================================
// Zweck:  Hell/Dunkel-Layout fuer ALLE Seiten der Web-App.
//         - Beim Laden: gespeicherte Auswahl aus localStorage lesen
//         - Umschalt-Button: wechselt zwischen hell und dunkel
//         - Auswahl wird gespeichert (bleibt nach Neuladen erhalten)
//
// Technisch:
//   Das Theme steht als Attribut am <html>-Element:
//     <html data-theme="dark">  -> dunkles Layout
//     kein Attribut             -> helles Layout (Standard)
//   In styles.css gibt es einen Block [data-theme="dark"], der alle
//   CSS-Variablen auf dunkle Werte umschaltet.
//
// WICHTIG: Damit kein weisser Blitz beim Laden entsteht (FOUC), steht
//   in jeder HTML-Seite ein Mini-Script im <head>, das das Attribut
//   sofort setzt - noch bevor die Seite sichtbar wird.
//
// Voraussetzung: Diese Datei kann auf jeder Seite geladen werden,
//   auch ohne Login (der Theme-Umschalter ist fuer alle da).
// =====================================================================


// =====================================================================
// 1. THEME LESEN UND SETZEN
// =====================================================================

/**
 * Gibt das aktuell gespeicherte Theme zurueck.
 * @returns {string} 'dark' oder 'light'
 */
function leseTheme() {
    try {
        // localStorage kann in Privat-Modus blockiert sein -> try/catch
        return localStorage.getItem('alpa-theme') || 'light';
    } catch (e) {
        return 'light';
    }
}

/**
 * Setzt das Theme auf der Seite (ohne zu speichern).
 * @param {string} theme - 'dark' oder 'light'
 */
function setzeTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
    } else {
        // Attribut entfernen = helles Standard-Layout
        document.documentElement.removeAttribute('data-theme');
    }

    // Farbangabe des Browsers (Mobile-Adressleiste) mit anpassen
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
        meta.setAttribute('content', theme === 'dark' ? '#12161F' : '#003366');
    }

    // Alle Theme-Buttons auf der Seite beschriften
    beschrifteThemeButtons();
}

/**
 * Wechselt zwischen hell und dunkel und SPEICHERT die Auswahl.
 * Wird vom Umschalt-Button aufgerufen (onclick="toggleTheme()").
 */
function toggleTheme() {
    const neu = leseTheme() === 'dark' ? 'light' : 'dark';
    try {
        localStorage.setItem('alpa-theme', neu);
    } catch (e) {
        // Speichern fehlgeschlagen (z.B. Privat-Modus): nur umschalten
        console.warn('Theme konnte nicht gespeichert werden:', e.message);
    }
    setzeTheme(neu);
}


// =====================================================================
// 2. BUTTON-BESCHRIFTUNG
// =====================================================================

/**
 * Setzt den Text aller Theme-Buttons (.theme-toggle) je nach Theme.
 * Der Button zeigt immer an, was beim Klick PASSIERT:
 *   helles Layout aktiv  -> Button "Dunkel" (wechselt zu dunkel)
 *   dunkles Layout aktiv -> Button "Hell"   (wechselt zu hell)
 */
function beschrifteThemeButtons() {
    const istDunkel = document.documentElement.getAttribute('data-theme') === 'dark';
    document.querySelectorAll('.theme-toggle').forEach(btn => {
        btn.textContent = istDunkel ? 'Hell' : 'Dunkel';
        btn.setAttribute('title',
            istDunkel ? 'Zum hellen Layout wechseln'
                      : 'Zum dunklen Layout wechseln');
    });
}


// =====================================================================
// 3. INITIALISIERUNG BEIM SEITENLADEN
// =====================================================================

document.addEventListener('DOMContentLoaded', () => {
    // Gespeichertes Theme anwenden (das Mini-Script im <head> hat es
    // bereits gesetzt - hier nochmal zur Sicherheit, falls das
    // Mini-Script fehlt oder localStorage sich geaendert hat).
    setzeTheme(leseTheme());
});

// Sofort ausfuehren (falls das Script spaeter laed als DOMContentLoaded)
if (document.readyState !== 'loading') {
    setzeTheme(leseTheme());
}
