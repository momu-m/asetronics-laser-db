// =====================================================================
// ALPA - Admin-Bearbeitung (admin.js)
// =====================================================================
// Zweck:  Alle interaktiven Bearbeitungs-Funktionen - NUR FUER ADMINS.
//         - Produkt bearbeiten: Name, Status, Variablen-Typ, DMC-Struktur
//         - Archivieren / aus dem Archiv holen
//         - Loeschen als Soft-Delete (Papierkorb, nichts verschwindet)
//         - Wiederherstellen aus dem Papierkorb
//         - Kommentare pro Produkt (Autor + Datum)
//         - Aenderungshistorie (Audit-Log: wer, wann, was, alt -> neu)
//
// Struktur:
//   1. Detailseite: Bearbeiten-Modal, Archiv, Loeschen
//   2. Detailseite: Kommentare
//   3. Detailseite: Aenderungshistorie (Audit-Log fuer ein Produkt)
//   4. Verwaltungsseite (verwaltung.html): Archiv + Papierkorb + Log
//   5. Hilfsfunktionen
//
// WICHTIG:
//   - Diese Datei muss NACH app.js geladen werden (nutzt dessen
//     Funktionen isAdmin, showMessage, escapeHtml, formatDate).
//   - Das Audit-Log wird AUTOMATISCH von Datenbank-Triggern gefuellt
//     (siehe sql/13_admin_bearbeitung.sql). Hier passiert dafuer nichts.
//   - Ohne Admin-Rechte zeigt die Datenbank (RLS) jede Aktion zurueck,
//     selbst wenn jemand die Buttons im Browser sichtbar machen wuerde.
// =====================================================================


// =====================================================================
// 1. DETAILSEITE: BEARBEITEN-MODAL, ARCHIV, LOESCHEN
// =====================================================================

/**
 * Initialisiert die Admin-Teile der Detailseite.
 * Wird beim Seitenladen aufgerufen (unten im DOMContentLoaded).
 * Zeigt die Admin-Aktionsleiste nur an, wenn der User Admin ist.
 */
async function initDetailAdmin() {
    const admin = await isAdmin();

    if (!admin) {
        // Kein Admin -> alle Admin-Bloecke bleiben versteckt (Default
        // in der HTML-Datei: display:none). Nichts weiter zu tun.
        return;
    }

    // Aktionsleiste (Bearbeiten / Archiv / Loeschen) zeigen
    const leiste = document.getElementById('admin-aktionsleiste');
    if (leiste) leiste.style.display = 'flex';
}

/**
 * Wird von app.js aufgerufen, sobald das Produkt geladen ist
 * (Hook: window.nachProduktGeladen). Setzt die Buttons passend zum
 * Produkt-Zustand (z.B. "Archivieren" oder "Zurueck aus dem Archiv").
 *
 * @param {Object} produkt - Das geladene Produkt
 */
async function nachProduktGeladenHook(produkt) {
    // Fuer Kommentare und Historie merken
    window.adminProdukt = produkt;

    // Admin-Info-Kleinigkeiten im Kopf der Karte
    const hinweis = document.getElementById('admin-archiv-hinweis');
    if (hinweis && produkt.archiviert_am) {
        hinweis.style.display = 'block';
        hinweis.textContent =
            'Dieses Produkt liegt im Archiv (archiviert am ' +
            formatDate(produkt.archiviert_am) + ').';
    }

    // Archiv-Button korrekt beschriften
    const archivBtn = document.getElementById('btn-archiv');
    if (archivBtn) {
        archivBtn.textContent = produkt.archiviert_am
            ? 'Zurueck aus dem Archiv'
            : 'Archivieren';
    }

    // Kommentare und Historie laden (nur fuer Admins sichtbar;
    // loadData prueft das selbst nochmal)
    ladeKommentare(produkt.id);
    ladeAuditFuerProdukt(produkt.id);
}

// Hook fuer app.js bereitstellen (renderDetail ruft ihn auf)
window.nachProduktGeladen = nachProduktGeladenHook;


/**
 * Oeffnet das Bearbeiten-Fenster (Modal) mit den aktuellen Werten.
 * Nur Admin (die Datenbank prueft beim Speichern nochmal).
 */
function openBearbeitenModal() {
    const produkt = window.adminProdukt || window.aktuellesProdukt;
    if (!produkt) {
        alert('Produkt noch nicht geladen. Bitte kurz warten.');
        return;
    }

    // Felder mit den aktuellen Werten vorbefuellen
    document.getElementById('edit-bezeichnung').value = produkt.bezeichnung || '';
    document.getElementById('edit-status').value = produkt.status || 'konvertiert';
    document.getElementById('edit-variablen-typ').value = produkt.variablen_typ || '';
    document.getElementById('edit-dmc-struktur').value = produkt.dmc_struktur || '';

    // Alten Status merken (fuer die Historie beim Speichern)
    window.editStatusAlt = produkt.status;

    hideMessage('bearbeiten-message');
    document.getElementById('bearbeiten-modal').style.display = 'flex';
    document.getElementById('edit-bezeichnung').focus();
}

/**
 * Schliesst das Bearbeiten-Fenster ohne zu speichern.
 */
function closeBearbeitenModal() {
    document.getElementById('bearbeiten-modal').style.display = 'none';
}

/**
 * Speichert die geaenderten Produkt-Daten aus dem Modal.
 * - Prueft Admin-Rechte
 * - Schreibt das UPDATE in die Tabelle produkte
 * - Bei Status-Wechsel: zusaetzlicher Eintrag in status_historie
 *   (wie bisher, damit die alte Historie weitergefuehrt wird)
 * - Das Audit-Log schreibt die Datenbank automatisch (Trigger)
 */
async function produktSpeichern() {
    const produkt = window.adminProdukt || window.aktuellesProdukt;
    if (!produkt) return;

    const client = initSupabase();
    if (!client) return;

    // Admin-Pruefung (Datenbank prueft ueber RLS nochmal)
    if (!(await isAdmin())) {
        showMessage('Keine Berechtigung. Nur Admins duerfen bearbeiten.',
                    'error', 'bearbeiten-message');
        return;
    }

    // Werte aus dem Formular lesen und leeren Text trimmen
    const neueDaten = {
        bezeichnung:   document.getElementById('edit-bezeichnung').value.trim(),
        status:        document.getElementById('edit-status').value,
        variablen_typ: document.getElementById('edit-variablen-typ').value.trim(),
        dmc_struktur:  document.getElementById('edit-dmc-struktur').value.trim()
    };

    // Validierung: Bezeichnung darf nicht leer sein
    if (!neueDaten.bezeichnung) {
        showMessage('Die Bezeichnung darf nicht leer sein.',
                    'error', 'bearbeiten-message');
        return;
    }

    // Hinweis, falls der Name geaendert wird (Name ist EINDEUTIG in der DB)
    if (neueDaten.bezeichnung !== produkt.bezeichnung) {
        const ok = confirm(
            'Achtung: Du aenderst den Produktnamen.\n\n' +
            'Alt: ' + produkt.bezeichnung + '\n' +
            'Neu: ' + neueDaten.bezeichnung + '\n\n' +
            'Der Name muss eindeutig sein. Fortfahren?'
        );
        if (!ok) return;
    }

    showMessage('Speichere...', 'info', 'bearbeiten-message');

    // UPDATE in der Datenbank
    const { error: errUpdate } = await client
        .from('produkte')
        .update(neueDaten)
        .eq('id', produkt.id);

    if (errUpdate) {
        // Haeufige Fehler verstaendlich melden
        if (errUpdate.code === '23505' || (errUpdate.message || '').includes('duplicate')) {
            showMessage('Dieser Produktname existiert bereits (Name muss eindeutig sein).',
                        'error', 'bearbeiten-message');
        } else if ((errUpdate.message || '').includes('Could not find the column') ||
                   (errUpdate.message || '').includes('does not exist')) {
            showMessage('Datenbank-Migration fehlt: Bitte sql/13_admin_bearbeitung.sql ' +
                        'im Supabase SQL-Editor ausfuehren. (' + errUpdate.message + ')',
                        'error', 'bearbeiten-message');
        } else {
            showMessage('Fehler beim Speichern: ' + errUpdate.message,
                        'error', 'bearbeiten-message');
        }
        return;
    }

    // Bei Status-Wechsel: Eintrag in die bestehende status_historie
    // (gleiches Muster wie die alte Status-Aenderung in app.js)
    if (neueDaten.status !== window.editStatusAlt) {
        const { data: { session } } = await client.auth.getSession();
        await client
            .from('status_historie')
            .insert({
                produkt_id: produkt.id,
                status_von: window.editStatusAlt,
                status_nach: neueDaten.status,
                benutzer: session?.user?.email || 'unbekannt',
                bemerkung: 'Geaendert im Bearbeiten-Fenster'
            });
    }

    showMessage('Gespeichert. Lade Seite neu...', 'success', 'bearbeiten-message');

    // Seite neu laden, damit alle Anzeigen frisch sind
    setTimeout(() => window.location.reload(), 800);
}


/**
 * Archiviert das Produkt (erledigt) oder holt es zurueck.
 * Archiv = eigene Spalte archiviert_am. Der Status (z.B. freigegeben)
 * bleibt dabei unangetastet.
 */
async function produktArchivieren() {
    const produkt = window.adminProdukt || window.aktuellesProdukt;
    if (!produkt) return;

    const client = initSupabase();
    if (!client) return;
    if (!(await isAdmin())) {
        showMessage('Keine Berechtigung.', 'error', 'detail-message');
        return;
    }

    const istArchiviert = !!produkt.archiviert_am;

    // Sicherheitsabfrage vor jeder Archiv-Aktion
    const ok = confirm(istArchiviert
        ? 'Dieses Produkt aus dem Archiv zurueckholen?'
        : 'Dieses Produkt ins Archiv legen?\n\n' +
          'Es verschwindet NICHT - mit dem Filter "Archiv anzeigen" ' +
          'auf der Programm-Seite bleibt es jederzeit sichtbar.');
    if (!ok) return;

    // archiviert_am setzen (archivieren) oder loeschen (zurueckholen)
    const { error } = await client
        .from('produkte')
        .update({
            archiviert_am: istArchiviert ? null : new Date().toISOString()
        })
        .eq('id', produkt.id);

    if (error) {
        showMessage('Fehler: ' + error.message, 'error', 'detail-message');
        return;
    }

    showMessage(istArchiviert
        ? 'Produkt zurueck aus dem Archiv. Lade neu...'
        : 'Produkt archiviert. Lade neu...', 'success', 'detail-message');
    setTimeout(() => window.location.reload(), 800);
}


/**
 * Loescht ein Produkt als SOFT-DELETE:
 * Das Produkt wird NICHT entfernt, sondern bekommt nur einen
 * Loesch-Stempel (geloescht_am + geloescht_von). Es landet im
 * Admin-Bereich "Geloest" und kann jederzeit wiederhergestellt werden.
 */
async function produktLoeschen() {
    const produkt = window.adminProdukt || window.aktuellesProdukt;
    if (!produkt) return;

    const client = initSupabase();
    if (!client) return;
    if (!(await isAdmin())) {
        showMessage('Keine Berechtigung.', 'error', 'detail-message');
        return;
    }

    // Doppelte Sicherheitsabfrage mit Klartext-Erklärung
    const ok = confirm(
        'Produkt "' + produkt.bezeichnung + '" in den Papierkorb legen?\n\n' +
        'Es wird NICHT endgueltig geloescht:\n' +
        '- Admins finden es im Bereich "Verwaltung -> Geloscht"\n' +
        '- Es kann jederzeit wiederhergestellt werden\n' +
        '- Alle Programme und Dateien bleiben erhalten'
    );
    if (!ok) return;

    // Login-E-Mail fuer "geloescht_von" ermitteln
    const { data: { session } } = await client.auth.getSession();
    const email = session?.user?.email || 'unbekannt';

    // Soft-Delete: nur Stempel setzen, nichts entfernen
    const { error } = await client
        .from('produkte')
        .update({
            geloescht_am: new Date().toISOString(),
            geloescht_von: email
        })
        .eq('id', produkt.id);

    if (error) {
        showMessage('Fehler: ' + error.message, 'error', 'detail-message');
        return;
    }

    // Zurueck zur Liste (das Produkt ist jetzt im Papierkorb)
    window.location.href = 'produkte.html';
}


// =====================================================================
// 2. DETAILSEITE: KOMMENTARE PRO PRODUKT
// =====================================================================

/**
 * Laedt alle Kommentare zu einem Produkt und zeigt sie an.
 * Nur Admins sehen etwas (RLS liefert fuer andere keine Zeilen).
 *
 * @param {string} produktId - UUID des Produkts
 */
async function ladeKommentare(produktId) {
    const client = initSupabase();
    if (!client) return;

    const { data, error } = await client
        .from('produkt_kommentare')
        .select('*')
        .eq('produkt_id', produktId)
        .order('erstellt_am', { ascending: false });

    const block = document.getElementById('kommentare-block');
    if (!block) return;

    if (error) {
        // Tabelle fehlt noch -> Bereich einfach versteckt lassen
        console.warn('Kommentare nicht ladbar:', error.message);
        return;
    }

    // Bereich nur zeigen, wenn es Kommentare gibt ODER der User
    // Admin ist (dann sieht er das Eingabefeld)
    const admin = await isAdmin();
    if (!admin && data.length === 0) return;
    if (admin) block.style.display = 'block';

    renderKommentare(data || []);
}

/**
 * Rendert die Kommentar-Liste.
 * @param {Array} kommentare - Array von Kommentar-Objekten
 */
function renderKommentare(kommentare) {
    const liste = document.getElementById('kommentar-liste');
    if (!liste) return;

    if (kommentare.length === 0) {
        liste.innerHTML =
            '<div class="empty-state" style="padding: 16px;">' +
            'Noch keine Kommentare.</div>';
        return;
    }

    liste.innerHTML = kommentare.map(k => `
        <div class="kommentar-item">
            <div class="kommentar-kopf">
                <strong>${escapeHtml(k.autor)}</strong>
                <span class="kommentar-datum">${formatDate(k.erstellt_am)}</span>
                <button class="btn btn-sm btn-danger-ghost kommentar-del-btn"
                        title="Kommentar loeschen"
                        onclick="kommentarLoeschen('${escapeHtml(k.id)}')">
                    Loeschen
                </button>
            </div>
            <div class="kommentar-text">${escapeHtml(k.kommentar)}</div>
        </div>
    `).join('');
}

/**
 * Fuegt einen neuen Kommentar hinzu.
 * Autor = angemeldeter Admin, Datum setzt die Datenbank automatisch.
 */
async function kommentarHinzufuegen() {
    const produkt = window.adminProdukt || window.aktuellesProdukt;
    if (!produkt) return;

    const client = initSupabase();
    if (!client) return;

    const textFeld = document.getElementById('kommentar-text');
    const text = textFeld.value.trim();

    if (!text) {
        showMessage('Bitte einen Kommentarstext eingeben.', 'error', 'detail-message');
        return;
    }
    if (!(await isAdmin())) {
        showMessage('Keine Berechtigung.', 'error', 'detail-message');
        return;
    }

    const { data: { session } } = await client.auth.getSession();
    const email = session?.user?.email || 'unbekannt';

    const { error } = await client
        .from('produkt_kommentare')
        .insert({
            produkt_id: produkt.id,
            autor: email,
            kommentar: text
        });

    if (error) {
        showMessage('Fehler beim Speichern des Kommentars: ' + error.message,
                    'error', 'detail-message');
        return;
    }

    textFeld.value = '';           // Feld leeren
    ladeKommentare(produkt.id);    // Liste neu laden
}

/**
 * Loescht einen Kommentar (nur Admin).
 * @param {string} kommentarId - UUID des Kommentars
 */
async function kommentarLoeschen(kommentarId) {
    const client = initSupabase();
    if (!client) return;

    if (!(await isAdmin())) return;

    const ok = confirm('Diesen Kommentar wirklich loeschen?');
    if (!ok) return;

    const { error } = await client
        .from('produkt_kommentare')
        .delete()
        .eq('id', kommentarId);

    if (error) {
        showMessage('Fehler beim Loeschen: ' + error.message, 'error', 'detail-message');
        return;
    }

    const produkt = window.adminProdukt || window.aktuellesProdukt;
    if (produkt) ladeKommentare(produkt.id);
}


// =====================================================================
// 3. DETAILSEITE: AENDERUNGSHISTORIE (AUDIT-LOG EINES PRODUKTS)
// =====================================================================

/**
 * Laedt die letzten 50 Log-Eintraege fuer ein Produkt und zeigt sie
 * als Tabelle (wer, wann, was, alt -> neu).
 *
 * @param {string} produktId - UUID des Produkts
 */
async function ladeAuditFuerProdukt(produktId) {
    const client = initSupabase();
    if (!client) return;

    const { data, error } = await client
        .from('audit_log')
        .select('*')
        .eq('produkt_id', produktId)
        .order('erstellt_am', { ascending: false })
        .limit(50);

    const block = document.getElementById('historie-block');
    if (!block) return;

    if (error) {
        // Tabelle fehlt noch -> Bereich versteckt lassen
        console.warn('Audit-Log nicht ladbar:', error.message);
        return;
    }

    block.style.display = 'block';
    renderAuditTabelle('historie-tabelle-body', data || []);
}


// =====================================================================
// 4. VERWALTUNGSSEITE (verwaltung.html): ARCHIV + PAPIERKORB + LOG
// =====================================================================

/**
 * Initialisiert die Verwaltungs-Seite.
 * Laedt alles fuer Admins; fuer Nicht-Admins erscheint ein Hinweis.
 */
async function initVerwaltung() {
    const admin = await isAdmin();

    if (!admin) {
        const hinweis = document.getElementById('no-admin-hint');
        if (hinweis) hinweis.style.display = 'block';
        ['section-archiv', 'section-geloescht', 'section-audit'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        return;
    }

    await ladeVerwaltung();
}

/**
 * Laedt alle noetigen Daten fuer die Verwaltungs-Seite:
 * - alle Produkte (inklusive archivierte und geloeschte; RLS erlaubt
 *   Admins den vollen Zugriff)
 * - die letzten 100 Audit-Log-Eintraege (global)
 */
async function ladeVerwaltung() {
    const client = initSupabase();
    if (!client) return;

    // 1. Alle Produkte laden (Admin sieht alle, auch geloeschte)
    const { data: produkte, error } = await client
        .from('produkte')
        .select('id, bezeichnung, ase_materialnr, status, ' +
                'archiviert_am, geloescht_am, geloescht_von')
        .order('bezeichnung', { ascending: true });

    if (error) {
        // Verstaendlicher Hinweis, wenn die DB-Migration noch fehlt
        // (PGRST204 = angeforderte Spalte existiert nicht)
        if ((error.code === 'PGRST204') ||
            (error.message || '').includes('Could not find the column') ||
            (error.message || '').includes('does not exist')) {
            showMessage(
                'Die Datenbank-Erweiterung ist noch nicht eingespielt. ' +
                'Bitte im Supabase SQL-Editor das Skript ' +
                'sql/13_admin_bearbeitung.sql ausfuehren (3 Klicks, ' +
                'Anleitung im Projektgedaechtnis). Danach diese Seite neu laden.',
                'error'
            );
        } else {
            showMessage('Fehler beim Laden: ' + error.message, 'error');
        }
        return;
    }

    // 2. In zwei Gruppen teilen:
    //    - Archiv: archiviert, aber nicht geloescht
    //    - Papierkorb: geloescht (geloescht_am gesetzt)
    const archiv = (produkte || []).filter(
        p => p.archiviert_am && !p.geloescht_am);
    const geloescht = (produkte || []).filter(p => p.geloescht_am);

    document.getElementById('archiv-count').textContent = archiv.length;
    document.getElementById('geloescht-count').textContent = geloescht.length;

    renderArchivListe(archiv);
    renderGeloeschtListe(geloescht);

    // 3. Globalen Audit-Log laden (neueste 100 Eintraege)
    const { data: log, error: errLog } = await client
        .from('audit_log')
        .select('*')
        .order('erstellt_am', { ascending: false })
        .limit(100);

    if (errLog) {
        console.warn('Audit-Log nicht ladbar:', errLog.message);
        return;
    }

    document.getElementById('audit-count').textContent = (log || []).length;
    renderAuditTabelle('audit-table-body', log || [], true);
}

/**
 * Rendert die Archiv-Liste (Karten mit Buttons).
 * @param {Array} archiv - archivierte Produkte
 */
function renderArchivListe(archiv) {
    const container = document.getElementById('archiv-liste');

    if (!archiv || archiv.length === 0) {
        container.innerHTML =
            '<div class="empty-state">Keine Produkte im Archiv.</div>';
        return;
    }

    container.innerHTML = archiv.map(p => `
        <div class="anfrage-karte anfrage-karte-archiv">
            <div class="anfrage-info">
                <div class="anfrage-name">${escapeHtml(p.bezeichnung)}</div>
                <div class="anfrage-email mono">${escapeHtml(p.ase_materialnr || '-')}</div>
                <div class="anfrage-meta">
                    Status: ${escapeHtml(p.status || '-')} &middot;
                    Archiviert am ${formatDate(p.archiviert_am)}
                </div>
            </div>
            <div class="anfrage-aktionen">
                <a class="btn btn-secondary btn-sm"
                   href="detail.html?id=${encodeURIComponent(p.id)}">Ansehen</a>
                <button class="btn btn-primary btn-sm"
                        onclick="verwaltungDeArchivieren('${escapeHtml(p.id)}', '${escapeHtml(p.bezeichnung)}')">
                    Zurueck aktivieren
                </button>
            </div>
        </div>
    `).join('');
}

/**
 * Rendert die Papierkorb-Liste (geloeschte Produkte, mit Wiederherstellen).
 * @param {Array} geloescht - geloeschte Produkte
 */
function renderGeloeschtListe(geloescht) {
    const container = document.getElementById('geloescht-liste');

    if (!geloescht || geloescht.length === 0) {
        container.innerHTML =
            '<div class="empty-state">Papierkorb leer. Nichts wurde geloescht.</div>';
        return;
    }

    container.innerHTML = geloescht.map(p => `
        <div class="anfrage-karte anfrage-karte-geloescht">
            <div class="anfrage-info">
                <div class="anfrage-name">${escapeHtml(p.bezeichnung)}</div>
                <div class="anfrage-email mono">${escapeHtml(p.ase_materialnr || '-')}</div>
                <div class="anfrage-meta">
                    Geloescht von ${escapeHtml(p.geloescht_von || 'unbekannt')}
                    am ${formatDate(p.geloescht_am)}
                </div>
            </div>
            <div class="anfrage-aktionen">
                <button class="btn btn-primary btn-sm"
                        onclick="wiederherstellen('${escapeHtml(p.id)}', '${escapeHtml(p.bezeichnung)}')">
                    Wiederherstellen
                </button>
            </div>
        </div>
    `).join('');
}

/**
 * Holt ein Produkt aus dem Papierkorb zurueck
 * (geloescht_am und geloescht_von loeschen).
 *
 * @param {string} produktId - UUID
 * @param {string} name - Bezeichnung (nur fuer die Abfrage)
 */
async function wiederherstellen(produktId, name) {
    const client = initSupabase();
    if (!client) return;

    const ok = confirm(
        'Produkt "' + name + '" wiederherstellen?\n' +
        'Es erscheint danach wieder ganz normal in der Programm-Liste.'
    );
    if (!ok) return;

    const { error } = await client
        .from('produkte')
        .update({ geloescht_am: null, geloescht_von: null })
        .eq('id', produktId);

    if (error) {
        showMessage('Fehler beim Wiederherstellen: ' + error.message, 'error');
        return;
    }

    showMessage('Wiederhergestellt: ' + name, 'success');
    await ladeVerwaltung();
}

/**
 * Holt ein Produkt aus dem Archiv zurueck (archiviert_am loeschen).
 * @param {string} produktId - UUID
 * @param {string} name - Bezeichnung (fuer die Abfrage)
 */
async function verwaltungDeArchivieren(produktId, name) {
    const client = initSupabase();
    if (!client) return;

    const ok = confirm('Produkt "' + name + '" aus dem Archiv holen?');
    if (!ok) return;

    const { error } = await client
        .from('produkte')
        .update({ archiviert_am: null })
        .eq('id', produktId);

    if (error) {
        showMessage('Fehler: ' + error.message, 'error');
        return;
    }

    showMessage('Zurueck aktiviert: ' + name, 'success');
    await ladeVerwaltung();
}


// =====================================================================
// 5. GEMEINSAME HILFSFUNKTIONEN
// =====================================================================

/**
 * Schöne deutsche Bezeichnung fuer eine Audit-Aktion.
 * @param {string} aktion
 * @returns {string}
 */
function auditAktionText(aktion) {
    const texte = {
        'bearbeiten':       'Bearbeitet',
        'archivieren':      'Archiviert',
        'de-archivieren':   'Aus Archiv geholt',
        'loeschen':         'Geloescht (Papierkorb)',
        'wiederherstellen': 'Wiederhergestellt',
        'kommentar':        'Kommentar'
    };
    return texte[aktion] || aktion;
}

/**
 * Rendert eine Audit-Log-Tabelle.
 * Wird sowohl auf der Detailseite (ein Produkt) als auch auf der
 * Verwaltungsseite (global) verwendet.
 *
 * @param {string} tbodyId - ID des tbody-Elements
 * @param {Array} eintraege - Audit-Log-Eintraege
 * @param {boolean} mitProdukt - true: Produktnamen-Spalte anzeigen
 */
function renderAuditTabelle(tbodyId, eintraege, mitProdukt = false) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    if (!eintraege || eintraege.length === 0) {
        const spalten = mitProdukt ? 6 : 5;
        tbody.innerHTML =
            '<tr><td colspan="' + spalten + '" class="empty-state">' +
            'Keine Eintraege. Aenderungen erscheinen hier automatisch.</td></tr>';
        return;
    }

    tbody.innerHTML = eintraege.map(e => {
        // "alt -> neu" nur zeigen, wenn es Werte gibt
        const aenderung = (e.alt_wert !== null && e.alt_wert !== undefined)
            ? '<span class="audit-alt">' + (escapeHtml(e.alt_wert) || '(leer)') + '</span>' +
              ' &rarr; ' +
              '<span class="audit-neu">' + (escapeHtml(e.neu_wert) || '(leer)') + '</span>'
            : '<span class="audit-neu">' + (escapeHtml(e.neu_wert) || '-') + '</span>';

        return `
        <tr>
            <td style="white-space: nowrap;">${formatDate(e.erstellt_am)}</td>
            <td>${escapeHtml(e.benutzer)}</td>
            <td><span class="badge badge-${e.aktion === 'loeschen' ? 'gesperrt' : 'konvertiert'}">${auditAktionText(e.aktion)}</span></td>
            <td>${escapeHtml(e.feld || '-')}</td>
            ${mitProdukt ? '<td>' + escapeHtml(e.produkt_name || '-') + '</td>' : ''}
            <td class="mono" style="font-size: 11px;">${aenderung}</td>
        </tr>`;
    }).join('');
}


// =====================================================================
// 6. SEITEN-INITIALISIERUNG
// =====================================================================

document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body.getAttribute('data-page');

    if (page === 'detail') {
        await initDetailAdmin();
    }

    if (page === 'verwaltung') {
        await initVerwaltung();
    }
});

// Klick auf den dunklen Hintergrund schliesst das Bearbeiten-Fenster
document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'bearbeiten-modal') {
        closeBearbeitenModal();
    }
});

// Escape-Taste schliesst das Bearbeiten-Fenster
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const modal = document.getElementById('bearbeiten-modal');
        if (modal && modal.style.display === 'flex') closeBearbeitenModal();
    }
});
