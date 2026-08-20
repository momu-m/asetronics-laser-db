// =====================================================================
// ALPA - Haupt-JavaScript (app.js)
// =====================================================================
// Zweck:  Alle Funktionen fuer die Laser-Programm-Datenbank.
//         - Login / Logout / Session pruefen
//         - Produkte laden und anzeigen
//         - Detailansicht mit Positionen
//         - ZIP-Download (PROGRAM + PRODUCTLAYOUT)
//         - Status-Aenderung (nur Admin)
//
// Struktur:
//   1. Hilfsfunktionen (Meldungen anzeigen, URL-Parameter)
//   2. Authentifizierung (Login, Logout, Session)
//   3. Produkte (Liste laden, Filter, Suche)
//   4. Detail (Produkt + Positionen + Programme)
//   5. Download (ZIP erstellen)
//   6. Admin (Status aendern)
//
// Voraussetzung: config.js muss VOR app.js geladen werden.
// =====================================================================


// =====================================================================
// 1. HILFSFUNKTIONEN
// =====================================================================

/**
 * Zeigt eine Meldung auf der Seite an.
 * @param {string} text - Der Meldungstext
 * @param {string} type - 'error', 'success' oder 'info'
 * @param {string} elementId - ID des HTML-Elements fuer die Meldung
 */
function showMessage(text, type = 'info', elementId = 'message') {
    const element = document.getElementById(elementId);
    if (!element) return;

    element.className = `alert alert-${type}`;
    element.textContent = text;
    element.style.display = 'block';
}

/**
 * Versteckt eine Meldung.
 * @param {string} elementId - ID des HTML-Elements
 */
function hideMessage(elementId = 'message') {
    const element = document.getElementById(elementId);
    if (element) {
        element.style.display = 'none';
    }
}

/**
 * Liest einen Parameter aus der URL.
 * Beispiel: detail.html?id=123 -> getQueryParam('id') = '123'
 * @param {string} name - Parametername
 * @returns {string|null} Wert oder null
 */
function getQueryParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
}

/**
 * Formatiert eine Zahl (float) als deutsche Kommazahl.
 * 1.5 -> "1,5", 284.4 -> "284,4"
 * @param {number} value
 * @returns {string}
 */
function formatNumber(value) {
    if (value === null || value === undefined) return '-';
    return Number(value).toLocaleString('de-DE', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 3
    });
}

/**
 * Formatiert einen Zeitstempel als deutsches Datum.
 * @param {string} timestamp - ISO-Zeitstempel
 * @returns {string}
 */
function formatDate(timestamp) {
    if (!timestamp) return '-';
    const date = new Date(timestamp);
    return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

/**
 * Gibt die CSS-Klasse fuer einen Status zurueck.
 * @param {string} status - konvertiert/testgelasert/freigegeben/gesperrt
 * @returns {string} CSS-Klassen-Name
 */
function getStatusBadgeClass(status) {
    const classes = {
        'konvertiert':   'badge badge-konvertiert',
        'testgelasert':  'badge badge-testgelasert',
        'freigegeben':   'badge badge-freigegeben',
        'gesperrt':      'badge badge-gesperrt'
    };
    return classes[status] || 'badge';
}

/**
 * Verwandelt HTML-Sonderzeichen in unschaedlichen Text.
 * Verhindert XSS-Angriffe (Cross-Site Scripting), falls ein
 * Feld boesen Code enthaelt (z.B. <script>...).
 *
 * WICHTIG: JEDE Ausgabe von Datenbank-Werten in innerHTML muss
 *          zwingend durch escapeHtml() laufen!
 *
 * @param {string} text - Roher Text aus der Datenbank
 * @returns {string} Sicherer Text fuer HTML
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')     // & muss zuerst (sonst doppelt escaped)
        .replace(/</g, '&lt;')      // < Kleiner-als
        .replace(/>/g, '&gt;')      // > Groesser-als
        .replace(/"/g, '&quot;')    // " Anfuehrungszeichen
        .replace(/'/g, '&#39;');    // ' Hochkomma
}


// =====================================================================
// 2. AUTHENTIFIZIERUNG
// =====================================================================

/**
 * Prueft, ob ein Benutzer angemeldet ist.
 * Wenn nicht: Weiterleitung zur Login-Seite.
 * Muss auf jeder geschuetzten Seite beim Laden aufgerufen werden.
 *
 * @returns {Object|null} Benutzer-Objekt oder null (dann Weiterleitung)
 */
async function checkAuth() {
    const client = initSupabase();
    if (!client) return null;

    // Aktuelle Session abfragen
    const { data: { session }, error } = await client.auth.getSession();

    if (error || !session) {
        // Nicht angemeldet -> zur Login-Seite
        window.location.href = 'index.html';
        return null;
    }

    return session;
}

/**
 * Login mit E-Mail und Passwort.
 * Wird vom Login-Formular aufgerufen.
 *
 * ABLAUF (mit Freigabe-Workflow seit 10.08.2026):
 *   1. Supabase signInWithPassword prueft E-Mail/Passwort
 *   2. Falls Login OK: profile.status aus DB laden
 *   3. Bei status='approved': weiter zu produkte.html
 *   4. Bei status='pending': Hinweis "Warte auf Freigabe" + Logout
 *   5. Bei status='rejected': Hinweis "Abgelehnt" + Logout
 */
async function login(event) {
    event.preventDefault();   // Verhindert Seiten-Neuladen

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const client = initSupabase();

    if (!client) {
        showMessage(
            'Supabase ist nicht konfiguriert. Siehe docs/ANLEITUNG_SETUP.md',
            'error'
        );
        return;
    }

    // 1. Anmelden
    const { data, error } = await client.auth.signInWithPassword({
        email: email,
        password: password
    });

    if (error) {
        showMessage(
            'Login fehlgeschlagen: ' + error.message,
            'error'
        );
        return;
    }

    // 2. profile.status laden, um zu pruefen ob freigegeben
    const { data: profile, error: profileErr } = await client
        .from('profile')
        .select('status, voller_name, rolle')
        .eq('id', data.user.id)
        .single();

    // Spezialfall: Login OK, aber kein profile vorhanden.
    // Das passiert wenn der Trigger noch nicht lief oder der User
    // aelter ist. Wir zeigen einen Hinweis und loggen aus.
    if (profileErr || !profile) {
        await client.auth.signOut();
        showMessage(
            'Dein Konto hat noch kein Profil. ' +
            'Wende dich an Mohamad Murad.',
            'error'
        );
        return;
    }

    // 3. Status auswerten
    if (profile.status === 'approved') {
        // Freigegeben -> weiter zur Produktliste
        window.location.href = 'produkte.html';
        return;
    }

    if (profile.status === 'pending') {
        // Wartet auf Freigabe -> Hinweis + Logout
        await client.auth.signOut();
        showMessage(
            'Dein Konto wartet noch auf Freigabe durch Mohamad Murad. ' +
            'Bitte wende dich an ihn, falls es eilt.',
            'info'
        );
        return;
    }

    if (profile.status === 'rejected') {
        // Abgelehnt -> Hinweis + Logout
        await client.auth.signOut();
        showMessage(
            'Dein Zugangsantrag wurde abgelehnt. ' +
            'Bei Fragen wende dich an Mohamad Murad.',
            'error'
        );
        return;
    }

    // Fallback (sollte nicht vorkommen): durchlassen
    window.location.href = 'produkte.html';
}

/**
 * Meldet den Benutzer ab.
 */
async function logout() {
    const client = initSupabase();
    if (client) {
        await client.auth.signOut();
    }
    window.location.href = 'index.html';
}

/**
 * Zeigt den angemeldeten Benutzer im Header an.
 * @param {Object} session - Die aktuelle Session
 */
function displayUserInfo(session) {
    const userElement = document.getElementById('user-email');
    if (userElement && session.user) {
        userElement.textContent = session.user.email;
    }
}


// =====================================================================
// 3. PRODUKTE - LISTE LADEN
// =====================================================================

/**
 * Laedt alle Produkte aus der Datenbank und zeigt sie als Tabelle.
 * Wird beim Laden von produkte.html aufgerufen.
 */
async function loadProdukte() {
    const client = initSupabase();
    if (!client) {
        showMessage('Supabase nicht konfiguriert.', 'error');
        return;
    }

    // Lade-Anzeige
    document.getElementById('produkte-table-body').innerHTML =
        '<tr><td colspan="5" class="loading">Lade Produkte...</td></tr>';

    // Alle Produkte abfragen (Supabase macht automatisch RLS)
    const { data: produkte, error } = await client
        .from('produkte')
        .select('*')
        .order('bezeichnung', { ascending: true });

    if (error) {
        showMessage('Fehler beim Laden: ' + error.message, 'error');
        document.getElementById('produkte-table-body').innerHTML = '';
        return;
    }

    // Speichere Produkte fuer Filter
    window.alleProdukte = produkte;

    // Tabelle rendern
    renderProdukteTabelle(produkte);
}

/**
 * Laedt die Warnungen des Batch-Konverters (warnungen.json).
 * Diese Datei erzeugt der Konverter automatisch. Sie enthaelt
 * Plausibilitaetswarnungen (z.B. unlogische Reihenfolge oder
 * Koordinaten ausserhalb der Platine). Die Web-App zeigt sie ROT.
 * Neu: 20.08.2026, Wunsch von Mohamad.
 * @returns {Object} Map: Produktbezeichnung -> { ase_nr, meldungen }
 */
async function ladeWarnungen() {
    // Nur einmal pro Seitenaufruf laden
    if (window.produktWarnungen !== undefined) return window.produktWarnungen;
    try {
        const antwort = await fetch('warnungen.json');
        if (!antwort.ok) throw new Error('HTTP ' + antwort.status);
        const daten = await antwort.json();
        window.produktWarnungen = daten.produkte || {};
    } catch (err) {
        console.warn('warnungen.json nicht ladbar:', err.message);
        window.produktWarnungen = {};
    }
    return window.produktWarnungen;
}

/**
 * Rendert die Produkt-Tabelle.
 * @param {Array} produkte - Array von Produkt-Objekten
 */
async function renderProdukteTabelle(produkte) {
    const tbody = document.getElementById('produkte-table-body');

    if (!produkte || produkte.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="6" class="empty-state">Keine Programme gefunden.</td></tr>';
        return;
    }

    // Konverter-Warnungen laden (fuer die roten Badges)
    const warnungen = await ladeWarnungen();

    // HTML fuer jede Zeile generieren.
    // WICHTIG: Alle Datenbank-Werte werden durch escapeHtml() gesichert,
    //          damit kein boeser Code (XSS) ausgefuehrt werden kann.
    tbody.innerHTML = produkte.map(p => {
        // Rotes Warnungs-Badge, wenn der Konverter etwas gefunden hat
        const hatWarnung = warnungen && warnungen[p.bezeichnung];
        const warnungBadge = hatWarnung
            ? ' <span class="badge badge-warnung" title="' +
              escapeHtml(warnungen[p.bezeichnung].meldungen.join(' | ')) +
              '">WARNUNG</span>'
            : '';
        return `
        <tr class="clickable produkte-row${hatWarnung ? ' row-warnung' : ''}"
            data-produkt-id="${escapeHtml(p.id)}">
            <td><strong>${escapeHtml(p.bezeichnung)}</strong>${warnungBadge}</td>
            <td class="mono">${escapeHtml(p.ase_materialnr) || '-'}</td>
            <td>${escapeHtml(p.material) || '-'}</td>
            <td class="numeric">
                ${p.xsize ? formatNumber(p.xsize) + ' &times; ' +
                            formatNumber(p.ysize) + ' &times; ' +
                            formatNumber(p.zsize) + ' mm' : '-'}
            </td>
            <td class="mono" style="font-size: 11px;">
                ${escapeHtml(p.variablen_typ) || '-'}
            </td>
            <td>
                <span class="${getStatusBadgeClass(p.status)}">${escapeHtml(p.status)}</span>
            </td>
            <td>${formatDate(p.erstellt_am)}</td>
        </tr>`;
    }).join('');

    // Event-Listener statt onclick (XSS-Sicherheit nach MiniMax-Review K4).
    tbody.querySelectorAll('.produkte-row').forEach(row => {
        row.addEventListener('click', function() {
            const id = this.getAttribute('data-produkt-id');
            window.location.href = 'detail.html?id=' + encodeURIComponent(id);
        });
    });
}

/**
 * Filtert die Produktliste nach Suchbegriff, Status und Variablen-Typ.
 * Wird bei jeder Aenderung der Filter aufgerufen.
 */
function filterProdukte() {
    const suchbegriff = document.getElementById('suche').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;
    const varFilter = document.getElementById('var-filter') ?
        document.getElementById('var-filter').value : '';

    let gefiltert = window.alleProdukte || [];

    // Nach Bezeichnung/Materialnummer suchen
    if (suchbegriff) {
        gefiltert = gefiltert.filter(p =>
            (p.bezeichnung && p.bezeichnung.toLowerCase().includes(suchbegriff)) ||
            (p.ase_materialnr && p.ase_materialnr.toLowerCase().includes(suchbegriff))
        );
    }

    // Nach Status filtern
    if (statusFilter) {
        gefiltert = gefiltert.filter(p => p.status === statusFilter);
    }

    // Nach Variablen-Typ filtern
    if (varFilter) {
        if (varFilter === 'keine') {
            gefiltert = gefiltert.filter(p => !p.variablen_typ);
        } else {
            gefiltert = gefiltert.filter(p =>
                p.variablen_typ && p.variablen_typ.startsWith(varFilter));
        }
    }

    renderProdukteTabelle(gefiltert);
}


// =====================================================================
// 3b. CSV-EXPORT
// =====================================================================
// Beschluss 10.08.2026: Mo will die Produktliste fuer Werner / Sanjeev
// als CSV exportieren koennen. CSV oeffnet sich direkt in Excel.
// Alle Produkte (nicht nur die gefilterten) werden exportiert.


/**
 * Exportiert alle Produkte als CSV-Datei.
 * Datei heisst: alpa_produkte_YYYY-MM-DD.csv
 * Oeffnet sich direkt in Excel ohne Konvertierung.
 */
function exportCSV() {
    const produkte = window.alleProdukte || [];
    if (produkte.length === 0) {
        alert('Keine Produkte zum Exportieren vorhanden.');
        return;
    }

    // CSV-Header (Spaltenueberschriften)
    const headers = [
        'Bezeichnung',
        'ASE-Materialnr',
        'Material',
        'Lackierung',
        'Nutzen',
        'LP-Breite (mm)',
        'LP-Hoehe (mm)',
        'LP-Dicke (mm)',
        'Variablen-Typ',
        'DMC-Struktur',
        'Status',
        'Erfasst am',
        'Erfasser'
    ];

    // Hilfsfunktion: CSV-Wert quoten (Komma/Anfuehrungszeichen escapen)
    function csvVal(v) {
        if (v === null || v === undefined) return '';
        const s = String(v);
        if (s.includes(',') || s.includes('"') || s.includes('\n')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    // Zeilen bauen
    const rows = produkte.map(p => [
        csvVal(p.bezeichnung),
        csvVal(p.ase_materialnr),
        csvVal(p.material),
        csvVal(p.lacquer),
        csvVal(p.nutzen),
        csvVal(p.xsize),
        csvVal(p.ysize),
        csvVal(p.zsize),
        csvVal(p.variablen_typ),
        csvVal(p.dmc_struktur),
        csvVal(p.status),
        csvVal(p.erstellt_am ? new Date(p.erstellt_am).toLocaleDateString('de-CH') : ''),
        csvVal(p.erfasser)
    ].join(','));

    // CSV-Datei zusammenbauen (mit BOM fuer Excel Umlaut-Erkennung)
    const csv = '\ufeff' + headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    // Datum fuer Dateinamen
    const today = new Date().toISOString().split('T')[0];
    const filename = 'alpa_produkte_' + today + '.csv';

    // Download ausloesen
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}


// =====================================================================
// 4. DETAILANSICHT
// =====================================================================

/**
 * Laedt ein einzelnes Produkt mit allen Details.
 * Wird beim Laden von detail.html aufgerufen.
 */
async function loadDetail() {
    const id = getQueryParam('id');
    if (!id) {
        showMessage('Keine Produkt-ID angegeben.', 'error');
        return;
    }

    const client = initSupabase();
    if (!client) return;

    // 1. Produkt laden
    const { data: produkt, error: errProdukt } = await client
        .from('produkte')
        .select('*')
        .eq('id', id)
        .single();

    if (errProdukt || !produkt) {
        showMessage('Produkt nicht gefunden: ' +
            (errProdukt ? errProdukt.message : 'unbekannter Fehler'), 'error');
        return;
    }

    // 1b. Konverter-Warnungen anzeigen (rot, Neu 20.08.2026)
    // Der Batch-Konverter prueft Koordinaten und Reihenfolge auf
    // Plausibilitaet. Funde erscheinen hier als roter Block.
    try {
        const warnungen = await ladeWarnungen();
        const eintrag = warnungen && warnungen[produkt.bezeichnung];
        const container = document.getElementById('warnungen-container');
        if (eintrag && container) {
            const punkte = eintrag.meldungen
                .map(m => '<li>' + escapeHtml(m) + '</li>').join('');
            container.innerHTML =
                '<div class="warnung-block">' +
                '<div class="warnung-titel">WARNUNG - bitte am Laser pruefen ' +
                '(automatische Koordinatenpruefung vom ' +
                escapeHtml(eintrag.stand || '') + ')</div>' +
                '<ul>' + punkte + '</ul>' +
                '<div class="warnung-hinweis">Die Daten wurden EXAKT aus ' +
                'der Quelle uebernommen und nicht veraendert.</div>' +
                '</div>';
            container.style.display = 'block';
        }
    } catch (err) {
        console.warn('Warnungen nicht anzeigbar:', err.message);
    }

    // 2. Programme laden (alle Varianten)
    const { data: programme, error: errProg } = await client
        .from('programme')
        .select('*')
        .eq('produkt_id', id);

    // 3. Positionen laden
    const { data: positionen, error: errPos } = await client
        .from('positionen')
        .select('*')
        .eq('produkt_id', id)
        .order('posnr', { ascending: true });

    // Fehler bei Teil-Abfragen auswerten (MiniMax V4).
    // Auch wenn nur ein Teil fehlschlaegt, soll der User es erfahren.
    if (errProg) {
        console.error('Fehler beim Laden der Programme:', errProg.message);
        showMessage(
            'Programme konnten nicht geladen werden: ' + errProg.message,
            'error'
        );
    }
    if (errPos) {
        console.error('Fehler beim Laden der Positionen:', errPos.message);
        showMessage(
            'Positionen konnten nicht geladen werden: ' + errPos.message,
            'error'
        );
    }

    // Details anzeigen (leere Arrays bei Fehler)
    renderDetail(produkt, programme || [], positionen || []);

    // Schwestprodukte (gleiche Layout-Gruppe) laden, wenn vorhanden.
    // Beschluss 10.08.2026: Mo will sehen, welche anderen Artikelnummern
    // dasselbe physische LP-Layout nutzen (z.B. BM054-11HA teilt BM054-xxC
    // mit BM054-12HA, -21HA, -22HA, -44HA).
    if (produkt.layout_gruppe) {
        ladeSchwestprodukte(produkt.layout_gruppe, produkt.id);
    } else {
        // Kein Layout zugeordnet -> Bereich verstecken
        const block = document.getElementById('layout-gruppe-block');
        if (block) block.style.display = 'none';
    }
}

/**
 * Laedt alle Produkte, die dieselbe layout_gruppe haben wie das aktuelle.
 * Wird in der Detailansicht angezeigt ("Dieses Layout wird auch genutzt von:").
 *
 * @param {string} layoutGruppe - Name der Layout-Gruppe (z.B. "BM054-xxC")
 * @param {string} eigenesId   - ID des aktuell angezeigten Produkts (wird ausgeblendet)
 */
async function ladeSchwestprodukte(layoutGruppe, eigenesId) {
    const client = initSupabase();
    if (!client) return;

    const { data, error } = await client
        .from('produkte')
        .select('id, bezeichnung, ase_materialnr')
        .eq('layout_gruppe', layoutGruppe)
        .neq('id', eigenesId)
        .order('bezeichnung', { ascending: true });

    const block = document.getElementById('layout-gruppe-block');
    const liste = document.getElementById('layout-gruppe-liste');
    const titel = document.getElementById('layout-gruppe-name');

    if (error || !data) {
        console.error('Fehler beim Laden der Schwestprodukte:', error);
        if (block) block.style.display = 'none';
        return;
    }

    // Wenn keine anderen Produkte dieselbe Gruppe haben, Bereich verstecken.
    if (data.length === 0) {
        if (block) block.style.display = 'none';
        return;
    }

    // Gruppennamen anzeigen
    if (titel) titel.textContent = layoutGruppe;

    // Liste der Schwestprodukte als klickbare Links rendern.
    // XSS-Schutz: escapeHtml auf alle Werte aus der DB.
    if (liste) {
        liste.innerHTML = data.map(p => `
            <a href="detail.html?id=${encodeURIComponent(p.id)}"
               class="layout-schwester-link">
                ${escapeHtml(p.bezeichnung)}
                <span class="layout-schwester-matnr">(${escapeHtml(p.ase_materialnr || '-')})</span>
            </a>
        `).join('');
    }
    if (block) block.style.display = 'block';
}

/**
 * Rendert die Detail-Seite.
 * @param {Object} produkt
 * @param {Array} programme
 * @param {Array} positionen
 */
function renderDetail(produkt, programme, positionen) {
    // Produkt-ID fuer globale Verwendung speichern
    window.aktuellesProdukt = produkt;

    // Titel
    document.getElementById('detail-titel').textContent = produkt.bezeichnung;

    // Breadcrumb-Name setzen
    const breadcrumb = document.getElementById('breadcrumb-name');
    if (breadcrumb) breadcrumb.textContent = produkt.bezeichnung;

    // Meta-Zeile (Materialnr unter Titel)
    const metaMatnr = document.getElementById('detail-meta-matnr');
    if (metaMatnr) metaMatnr.textContent = produkt.ase_materialnr || '-';

    // Status-Badge
    const statusBadge = document.getElementById('detail-status');
    statusBadge.className = getStatusBadgeClass(produkt.status);
    statusBadge.textContent = produkt.status;

    // Info-Felder
    document.getElementById('info-masse').textContent =
        produkt.xsize ? formatNumber(produkt.xsize) + ' x ' +
                        formatNumber(produkt.ysize) + ' x ' +
                        formatNumber(produkt.zsize) + ' mm' : '-';
    document.getElementById('info-material').textContent =
        produkt.material || '-';
    document.getElementById('info-lacquer').textContent =
        produkt.lacquer || '-';
    document.getElementById('info-nutzen').textContent =
        produkt.nutzen || '-';
    document.getElementById('info-variablen-typ').textContent =
        produkt.variablen_typ || '-';
    document.getElementById('info-dmc-struktur').textContent =
        produkt.dmc_struktur || '-';
    document.getElementById('info-erstellt-am').textContent =
        formatDate(produkt.erstellt_am);
    document.getElementById('info-anzahl-positionen').textContent =
        positionen.length + ' Positionen';

    // Programme auflisten (Varianten wie -F, -G, ...)
    renderProgramme(programme);

    // Positionstabelle
    renderPositionen(positionen);

    // Koordinaten-Vorschau (Canvas mit Leiterplatte und Positionen).
    // Beschluss 10.08.2026: Mo will visuell sehen, ob die Positionen
    // plausibel sind. Verdächtige Muster werden farblich markiert.
    renderVorschau(produkt, positionen);
}

/**
 * Rendert die Liste der Programme (Varianten).
 */
function renderProgramme(programme) {
    const container = document.getElementById('programme-liste');

    if (!programme || programme.length === 0) {
        container.innerHTML =
            '<div class="empty-state">Keine Programme hinterlegt.</div>';
        return;
    }

    container.innerHTML = programme.map(prog => `
        <div class="program-row">
            <div class="program-info">
                <h4>${escapeHtml(prog.programm_name)}</h4>
                <div class="program-meta">
                    Quelle: ${escapeHtml(prog.laser_quelle) || '-'} &middot;
                    Konvertiert: ${formatDate(prog.konvertiert_am)}
                </div>
            </div>
            <button class="btn btn-download download-btn"
                    data-programm-id="${escapeHtml(prog.id)}"
                    data-programm-name="${escapeHtml(prog.programm_name)}">
                Download ZIP
            </button>
        </div>
    `).join('');

    // Event-Listener sicher registieren (XSS-Schutz nach MiniMax K4).
    // Statt onclick im HTML-Attribut (das bei ' im Namen brechen wuerde)
    // nutzen wir data-Attribute und addEventListener.
    container.querySelectorAll('.download-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const id = this.getAttribute('data-programm-id');
            const name = this.getAttribute('data-programm-name');
            downloadProgramm(id, name);
        });
    });
}

/**
 * Rendert die Positionstabelle.
 */
function renderPositionen(positionen, warnungen = {}) {
    const tbody = document.getElementById('positionen-table-body');

    if (!positionen || positionen.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="9" class="empty-state">Keine Positionen hinterlegt.</td></tr>';
        return;
    }

    tbody.innerHTML = positionen.map(pos => {
        const status = warnungen[pos.posnr] || 'ok';
        const statusLabel = {
            ok: '<span style="color:#2a9d8f;">OK</span>',
            ausserhalb: '<span style="color:#e76f51; font-weight:600;">Ausserhalb LP</span>',
            identisch: '<span style="color:#f4a261; font-weight:600;">Identisch</span>',
            nah: '<span style="color:#264653;">Sehr nah</span>'
        }[status];
        return `
        <tr>
            <td>${escapeHtml(pos.posnr)}</td>
            <td class="numeric">${pos.groupindex !== null ? escapeHtml(pos.groupindex) : '-'}</td>
            <td>${escapeHtml(pos.panelindex) || '-'}</td>
            <td>${pos.counterindex !== null ? escapeHtml(pos.counterindex) : '-'}</td>
            <td>${pos.paneledge ? 'Ja' : 'Nein'}</td>
            <td class="numeric">${formatNumber(pos.xpos)}</td>
            <td class="numeric">${formatNumber(pos.ypos)}</td>
            <td class="numeric">${formatNumber(pos.angle)}</td>
            <td>${statusLabel}</td>
        </tr>`;
    }).join('');
}


// =====================================================================
// 4b. KOORDINATEN-VORSCHAU (Canvas) + PLAUSIBILITAETS-CHECK
// =====================================================================
// Beschluss 10.08.2026: Mo will eine grafische Vorschau der LP mit allen
// Markierpositionen. Ausserdem eine Warnung bei verdächtigen Mustern,
// die darauf hindeuten, dass jemand Koordinaten manuell geaendert hat.
//
// Folgende Verdachtsmomente werden geprueft:
//   - ausserhalb: Koordinate liegt ausserhalb der LP-Masse
//   - identisch:  Zwei Positionen haben exakt dieselben X/Y-Werte
//                 (sehr unwahrscheinlich bei echter Produktion)
//   - nah:        Abstand zwischen zwei Positionen < 0.5 mm
//                 (ungewoehnlich nah, Kontrolle empfohlen)


/**
 * Prueft alle Positionen auf Plausibilitaet und gibt ein Map
 * posnr -> status ('ok', 'ausserhalb', 'identisch', 'nah') zurueck.
 *
 * @param {Array} positionen
 * @param {Object} produkt  - braucht xsize/ysize
 * @returns {Object} { warnungen: {...}, meldungen: [...] }
 */
function pruefePositionen(positionen, produkt) {
    const warnungen = {};
    const meldungen = [];

    // 1. AUSSENHALB: Position liegt ausserhalb der LP-Masse
    const maxX = parseFloat(produkt.xsize) || 0;
    const maxY = parseFloat(produkt.ysize) || 0;
    if (maxX > 0 && maxY > 0) {
        positionen.forEach(pos => {
            const x = parseFloat(pos.xpos);
            const y = parseFloat(pos.ypos);
            if (isNaN(x) || isNaN(y)) return;
            if (x < -2 || x > maxX + 2 || y < -2 || y > maxY + 2) {
                warnungen[pos.posnr] = 'ausserhalb';
                meldungen.push(
                    `Position ${pos.posnr}: Koordinate (${x.toFixed(2)}, ${y.toFixed(2)}) ` +
                    `liegt ausserhalb der LP (${maxX}x${maxY} mm).`
                );
            }
        });
    }

    // 2. IDENTISCH und 3. NAH: Paarweiser Abstand
    for (let i = 0; i < positionen.length; i++) {
        for (let j = i + 1; j < positionen.length; j++) {
            const a = positionen[i];
            const b = positionen[j];
            const ax = parseFloat(a.xpos), ay = parseFloat(a.ypos);
            const bx = parseFloat(b.xpos), by = parseFloat(b.ypos);
            if (isNaN(ax) || isNaN(ay) || isNaN(bx) || isNaN(by)) continue;
            const dist = Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
            if (dist < 0.01) {
                warnungen[a.posnr] = 'identisch';
                warnungen[b.posnr] = 'identisch';
                meldungen.push(
                    `Positionen ${a.posnr} und ${b.posnr} haben identische Koordinaten ` +
                    `(${ax.toFixed(2)}, ${ay.toFixed(2)}). Sehr wahrscheinlich manuell geaendert.`
                );
            } else if (dist < 0.5) {
                if (!warnungen[a.posnr]) warnungen[a.posnr] = 'nah';
                if (!warnungen[b.posnr]) warnungen[b.posnr] = 'nah';
                meldungen.push(
                    `Positionen ${a.posnr} und ${b.posnr} sind nur ${dist.toFixed(2)} mm ` +
                    `aneinander entfernt. Kontrolle empfohlen.`
                );
            }
        }
    }

    return { warnungen, meldungen };
}


/**
 * Zeichnet die Leiterplatte mit allen Positionen auf ein Canvas.
 * @param {Object} produkt
 * @param {Array} positionen
 */
function renderVorschau(produkt, positionen) {
    const block = document.getElementById('vorschau-block');
    const canvas = document.getElementById('vorschau-canvas');
    if (!block || !canvas) return;

    // Vorschau nur anzeigen wenn wir Positionen haben
    if (!positionen || positionen.length === 0) {
        block.style.display = 'none';
        return;
    }
    block.style.display = 'block';

    // Plausibilitaet pruefen
    const { warnungen, meldungen } = pruefePositionen(positionen, produkt);
    // Tabelle mit Status-Spalte neu rendern
    renderPositionen(positionen, warnungen);
    // Warnungen anzeigen
    const warnDiv = document.getElementById('vorschau-warnungen');
    if (meldungen.length === 0) {
        warnDiv.innerHTML = '<div style="color:#2a9d8f; font-size:13px;">' +
            'Keine Auffaelligkeiten. Alle Positionen plausibel.</div>';
    } else {
        warnDiv.innerHTML = '<div style="color:#e76f51; font-size:13px; font-weight:600;">' +
            meldungen.length + ' Auffaelligkeit(en) erkannt:</div>' +
            '<ul style="font-size:13px; color:#555; margin-top:6px;">' +
            meldungen.map(m => '<li>' + escapeHtml(m) + '</li>').join('') +
            '</ul>';
    }

    // Canvas vorbereiten
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // LP-Masse aus Produkt (Fallback: maximale Position)
    let maxX = parseFloat(produkt.xsize) || 0;
    let maxY = parseFloat(produkt.ysize) || 0;
    if (maxX === 0 || maxY === 0) {
        positionen.forEach(p => {
            maxX = Math.max(maxX, parseFloat(p.xpos) || 0);
            maxY = Math.max(maxY, parseFloat(p.ypos) || 0);
        });
        maxX = Math.max(maxX, 50) + 10;
        maxY = Math.max(maxY, 50) + 10;
    }

    // Rand fuer Achsenbeschriftung
    const margin = 40;
    const drawW = W - 2 * margin;
    const drawH = H - 2 * margin;
    const scaleX = drawW / maxX;
    const scaleY = drawH / maxY;
    // Gleichmassiger Massstab (LP nicht verzerren)
    const scale = Math.min(scaleX, scaleY);

    // LP-Rechteck zeichnen
    const lpX = margin;
    const lpY = margin;
    const lpW = maxX * scale;
    const lpH = maxY * scale;

    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(lpX, lpY, lpW, lpH);
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = 2;
    ctx.strokeRect(lpX, lpY, lpW, lpH);

    // Achsenbeschriftung
    ctx.fillStyle = '#6c757d';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('0', margin - 12, margin + lpH + 14);
    ctx.fillText(maxX.toFixed(0) + ' mm', margin + lpW - 30, margin + lpH + 14);
    ctx.save();
    ctx.translate(margin - 28, margin + 10);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(maxY.toFixed(0) + ' mm', 0, 0);
    ctx.restore();
    ctx.fillText('X ->', margin + lpW / 2 - 10, margin + lpH + 28);

    // Positionen zeichnen
    const farben = {
        ok:         '#2a9d8f',
        ausserhalb: '#e76f51',
        identisch:  '#f4a261',
        nah:        '#264653'
    };

    positionen.forEach((pos, idx) => {
        const px = parseFloat(pos.xpos);
        const py = parseFloat(pos.ypos);
        if (isNaN(px) || isNaN(py)) return;

        // Y-Koordinate invertieren (LP-Ursprung unten links)
        const cx = margin + px * scale;
        const cy = margin + lpH - py * scale;
        const status = warnungen[pos.posnr] || 'ok';
        const farbe = farben[status] || farben.ok;

        // Punkt zeichnen
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
        ctx.fillStyle = farbe;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Positionsnummer daneben
        ctx.fillStyle = '#212529';
        ctx.font = '10px IBM Plex Mono, monospace';
        ctx.fillText(pos.posnr, cx + 7, cy - 5);
    });

    // Titel oben
    ctx.fillStyle = '#212529';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillText(
        produkt.bezeichnung + ' - ' + positionen.length + ' Positionen',
        margin, margin - 16
    );
}


// =====================================================================
// 5. ZIP-DOWNLOAD
// =====================================================================

/**
 * Laedt PROGRAM und PRODUCTLAYOUT aus dem Supabase Storage und
 * erstellt daraus eine ZIP-Datei zum Download.
 *
 * @param {string} programmId - ID des Programms
 * @param {string} programmName - Name fuer die ZIP-Datei
 */
async function downloadProgramm(programmId, programmName) {
    const client = initSupabase();
    if (!client) return;

    showMessage('Download wird vorbereitet...', 'info', 'detail-message');

    try {
        // 1. Programm-Datensatz abfragen (fuer Dateipfade)
        const { data: programm, error: errProg } = await client
            .from('programme')
            .select('*')
            .eq('id', programmId)
            .single();

        if (errProg || !programm) {
            throw new Error('Programm nicht gefunden: ' +
                (errProg ? errProg.message : 'unbekannt'));
        }

        // 2. Pruefen, ob Dateipfade gesetzt sind
        if (!programm.file_program || !programm.file_product) {
            throw new Error(
                'Diesem Programm sind keine Dateien zugeordnet. ' +
                'Mohamad muss die Dateien noch hochladen.'
            );
        }

        // 3. PROGRAM-Datei aus Storage laden
        const { data: fileProgram, error: errFile1 } = await client
            .storage
            .from('programme')
            .download(programm.file_program);

        if (errFile1) {
            throw new Error('PROGRAM-Datei nicht ladbar: ' + errFile1.message);
        }

        // 4. PRODUCTLAYOUT-Datei aus Storage laden
        const { data: fileProduct, error: errFile2 } = await client
            .storage
            .from('programme')
            .download(programm.file_product);

        if (errFile2) {
            throw new Error('PRODUCTLAYOUT-Datei nicht ladbar: ' + errFile2.message);
        }

        // 5. ZIP erstellen mit JSZip (Bibliothek muss geladen sein)
        if (typeof JSZip === 'undefined') {
            // Fallback: Dateien einzeln herunterladen
            console.warn('JSZip nicht geladen - lade Dateien einzeln.');
            downloadBlob(fileProgram, programm.file_program.split('/').pop());
            setTimeout(() => {
                downloadBlob(fileProduct, programm.file_product.split('/').pop());
            }, 500);
            showMessage(
                'Dateien wurden einzeln heruntergeladen (JSZip fehlt).',
                'info',
                'detail-message'
            );
        } else {
            // ZIP erstellen
            const zip = new JSZip();
            zip.file(programm.file_program.split('/').pop(), fileProgram);
            zip.file(programm.file_product.split('/').pop(), fileProduct);

            const zipBlob = await zip.generateAsync({ type: 'blob' });

            // ZIP herunterladen
            downloadBlob(zipBlob, `${programmName}.zip`);

            showMessage(
                'Download erfolgreich: ' + programmName + '.zip',
                'success',
                'detail-message'
            );
        }

        // 6. Download in der Datenbank protokollieren
        await protokolliereDownload(programm);

    } catch (error) {
        console.error('Download-Fehler:', error);
        showMessage('Download-Fehler: ' + error.message, 'error', 'detail-message');
    }
}

/**
 * Laedt einen Blob (Binaerdaten) als Datei herunter.
 * @param {Blob} blob - Die Dateidaten
 * @param {string} filename - Dateiname
 */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);   // Speicher wieder freigeben
}

/**
 * Protokolliert einen Download in der Datenbank.
 * @param {Object} programm - Das heruntergeladene Programm
 */
async function protokolliereDownload(programm) {
    const client = initSupabase();
    if (!client) return;

    // Aktuelle Session fuer Benutzernamen
    const { data: { session } } = await client.auth.getSession();
    const benutzer = session?.user?.email || 'unbekannt';

    // Download-Eintrag einfuegen.
    // MiniMax V5: Fehler wird ausgewertet und auf der Konsole geloggt,
    // damit ein stillschweigender Verlust des Audit-Eintrags auffaellt.
    const { error } = await client
        .from('downloads')
        .insert({
            produkt_id: programm.produkt_id,
            programm_id: programm.id,
            benutzer: benutzer,
            kommentar: 'Download ueber Web-App'
        });

    if (error) {
        // Audit-Log ist wichtig - Fehler darf nicht still verschwinden.
        console.error('Audit-Log fehlgeschlagen:', error.message);
    }
}


// =====================================================================
// 6. ADMIN - STATUS AENDERN (nur fuer Mohamad)
// =====================================================================

/**
 * Prueft, ob der aktuelle Benutzer Admin ist.
 * @returns {Promise<boolean>}
 */
async function isAdmin() {
    const client = initSupabase();
    if (!client) return false;

    // app_settings abfragen (enthaelt admin_emails)
    const { data, error } = await client
        .from('app_settings')
        .select('admin_emails')
        .eq('id', 1)
        .single();

    if (error || !data) return false;

    // Aktuelle E-Mail
    const { data: { session } } = await client.auth.getSession();
    const meineEmail = session?.user?.email;

    // Case-insensitiver Vergleich (MiniMax S5): SQL-Seite bereits erledigt,
    // hier auch JS-seitig, damit UX und Datenbank uebereinstimmen.
    if (!meineEmail || !data.admin_emails) return false;
    const meineEmailLower = meineEmail.toLowerCase();
    return data.admin_emails.some(
        email => email.toLowerCase() === meineEmailLower
    );
}

/**
 * Aendert den Status eines Produkts (nur Admin).
 * @param {string} produktId - Produkt-ID
 * @param {string} neuerStatus - konvertiert/testgelasert/freigegeben/gesperrt
 * @param {string} bemerkung - Grund der Aenderung
 */
async function aendereStatus(produktId, neuerStatus, bemerkung = '') {
    const client = initSupabase();
    if (!client) return;

    // Admin-Pruefung
    const admin = await isAdmin();
    if (!admin) {
        showMessage(
            'Keine Berechtigung. Nur Mohamad darf den Status aendern.',
            'error'
        );
        return;
    }

    // Alten Status fuer Historie laden
    const { data: produkt } = await client
        .from('produkte')
        .select('status')
        .eq('id', produktId)
        .single();

    const alterStatus = produkt?.status || 'unbekannt';

    // Status aktualisieren
    const { error: errUpdate } = await client
        .from('produkte')
        .update({ status: neuerStatus })
        .eq('id', produktId);

    if (errUpdate) {
        showMessage('Fehler: ' + errUpdate.message, 'error');
        return;
    }

    // Historie eintragen
    const { data: { session } } = await client.auth.getSession();
    await client
        .from('status_historie')
        .insert({
            produkt_id: produktId,
            status_von: alterStatus,
            status_nach: neuerStatus,
            benutzer: session?.user?.email || 'unbekannt',
            bemerkung: bemerkung
        });

    showMessage(
        `Status geaendert: ${alterStatus} -> ${neuerStatus}`,
        'success'
    );

    // Seite neu laden, damit der neue Status angezeigt wird
    setTimeout(() => window.location.reload(), 1500);
}


// =====================================================================
// 6b. REGISTRIERUNG (Self-Service Signup)
// =====================================================================
// Beschluss 10.08.2026: Mohamad will, dass sich neue Personen selbst
// registrieren koennen, er aber jede Anfrage freigeben muss.
//
// Ablauf:
//   1. Person fuellt Formular (Name, E-Mail, Passwort)
//   2. supabase.auth.signUp() legt den User in auth.users an
//   3. Der Datenbank-Trigger legt automatisch eine profile-Zeile
//      mit status='pending' an
//   4. Mohamad sieht die Anfrage im Header-Badge und entscheidet


/**
 * Registriert einen neuen Benutzer.
 * Wird vom Registrierungs-Formular aufgerufen.
 *
 * @param {Event} event - Das Formular-Event
 */
async function register(event) {
    event.preventDefault();

    // Felder auslesen
    const vollerName = document.getElementById('voller-name').value.trim();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const password2 = document.getElementById('password2').value;

    // Client-Validierung (bevor wir Supabase fragen)
    if (vollerName.length < 3) {
        showMessage('Bitte deinen vollen Namen angeben.', 'error');
        return;
    }
    if (password.length < 8) {
        showMessage('Passwort muss mindestens 8 Zeichen lang sein.', 'error');
        return;
    }
    if (password !== password2) {
        showMessage('Die Passwoerter stimmen nicht ueberein.', 'error');
        return;
    }

    const client = initSupabase();
    if (!client) {
        showMessage('Supabase nicht konfiguriert.', 'error');
        return;
    }

    // signUp legt den User in auth.users an.
    // Der Trigger on_auth_user_created feuert automatisch und legt
    // die profile-Zeile mit status='pending' an.
    //
    // Der dritte Parameter "options.data" wird in raw_user_meta_data
    // gespeichert. Darueber uebergeben wir den vollen Namen an den Trigger.
    const { data, error } = await client.auth.signUp({
        email: email,
        password: password,
        options: {
            data: {
                voller_name: vollerName
            }
        }
    });

    if (error) {
        // Haeufige Fehler:
        // - "User already registered" -> E-Mail existiert schon
        // - "Password should be at least 6 characters" (Supabase-Default)
        showMessage(
            'Registrierung fehlgeschlagen: ' + error.message,
            'error'
        );
        return;
    }

    // Erfolg: Das Formular durch einen Hinweis ersetzen.
    // So kann die Person nichts Falsches mehr klicken.
    const form = document.getElementById('register-form');
    if (form) {
        form.innerHTML = `
            <div class="alert alert-success" style="margin-top: 16px;">
                <strong>Anfrage eingegangen.</strong><br><br>
                Hallo ${escapeHtml(vollerName)},<br><br>
                deine Anfrage wurde an Mohamad Murad weitergeleitet.
                Sobald er dich freischaltet, kannst du dich mit deiner
                E-Mail und deinem Passwort anmelden.<br><br>
                Du bekommst keine automatische E-Mail. Melde dich bei
                Mohamad, falls es eilt.
            </div>
            <p style="margin-top: 24px; font-size: 13px;">
                <a href="index.html" style="color: var(--as-accent); font-weight: 500;">
                    Zur Anmeldung
                </a>
            </p>
        `;
    }
}


// =====================================================================
// 6c. ADMIN-HEADER (Badge mit Anzahl offener Anfragen)
// =====================================================================


/**
 * Prueft, ob der aktuelle User Admin ist, und zeigt ggf. das
 * Admin-Badge sowie den Anfragen-Link mit Anzahl im Header.
 *
 * Wird auf produkte.html, detail.html und anfragen.html aufgerufen.
 *
 * @param {Object} session - Die aktuelle Supabase-Session
 */
async function ladeAdminHeader(session) {
    const admin = await isAdmin();
    if (!admin) {
        // Kein Admin -> Badge und Link verstecken (sind per Default hidden)
        return;
    }

    // Admin-Badge "ADMIN" anzeigen
    const badgeHeader = document.getElementById('admin-badge-header');
    if (badgeHeader) badgeHeader.style.display = 'inline-block';

    // Anfragen-Link anzeigen und Anzahl laden
    const link = document.getElementById('anfragen-link');
    if (!link) return;
    link.style.display = 'inline-flex';

    const client = initSupabase();
    if (!client) return;

    // Zaehle alle profile mit status='pending'.
    // Das geht durch die RLS-Policy, weil Admins alle profile lesen duerfen.
    const { count, error } = await client
        .from('profile')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');

    if (error) {
        console.error('Fehler beim Laden der Anfragen-Anzahl:', error.message);
        return;
    }

    const anzahl = count || 0;
    const countBadge = document.getElementById('anfragen-count-badge');
    if (countBadge) {
        if (anzahl > 0) {
            countBadge.textContent = anzahl;
            countBadge.style.display = 'inline-block';
        } else {
            countBadge.style.display = 'none';
        }
    }
}


// =====================================================================
// 6d. ANFRAGEN-SEITE (Admin-UI)
// =====================================================================
// Laedt alle User-Profile gruppiert nach Status (pending/approved/rejected)
// und zeigt sie in drei Listen an. Admins koennen:
//   - pending -> approved (mit Rolle bediener/admin)
//   - pending -> rejected (mit optionalem Grund)
//   - approved -> Rolle aendern (spaeter moeglich, aktuell Fokus auf Freigabe)


/**
 * Laedt alle Profile und rendert die drei Listen.
 * Wird beim Laden von anfragen.html aufgerufen.
 */
async function loadAnfragen() {
    const client = initSupabase();
    if (!client) return;

    // 1. Admin pruefen. Wenn kein Admin: Hinweis zeigen und abbrechen.
    const admin = await isAdmin();
    if (!admin) {
        document.getElementById('no-admin-hint').style.display = 'block';
        // Die drei sections verstecken
        document.getElementById('section-pending').style.display = 'none';
        document.getElementById('section-approved').style.display = 'none';
        document.getElementById('section-rejected').style.display = 'none';
        return;
    }

    // 2. Alle Profile laden, neueste zuerst.
    // RLS erlaubt Admins den Zugriff auf alle Zeilen.
    const { data: alleProfile, error } = await client
        .from('profile')
        .select('*')
        .order('erstellt_am', { ascending: false });

    if (error) {
        showMessage(
            'Fehler beim Laden der Anfragen: ' + error.message,
            'error'
        );
        return;
    }

    // 3. Nach Status gruppieren
    const pending   = alleProfile.filter(p => p.status === 'pending');
    const approved  = alleProfile.filter(p => p.status === 'approved');
    const rejected  = alleProfile.filter(p => p.status === 'rejected');

    // 4. Zaehler aktualisieren
    document.getElementById('pending-count').textContent = pending.length;
    document.getElementById('approved-count').textContent = approved.length;
    document.getElementById('rejected-count').textContent = rejected.length;

    // 5. Listen rendern
    renderPendingListe(pending);
    renderApprovedListe(approved);
    renderRejectedListe(rejected);
}


/**
 * Rendert die Liste der offenen (pending) Anfragen.
 * Pro Eintrag: Name, E-Mail, Datum, Buttons "Genehmigen als Bediener",
 * "Genehmigen als Admin", "Ablehnen".
 *
 * @param {Array} profile - Array von profile-Objekten mit status='pending'
 */
function renderPendingListe(profile) {
    const container = document.getElementById('pending-liste');

    if (!profile || profile.length === 0) {
        container.innerHTML =
            '<div class="empty-state">Keine offenen Anfragen. Alles erledigt.</div>';
        return;
    }

    container.innerHTML = profile.map(p => `
        <div class="anfrage-karte" data-profile-id="${escapeHtml(p.id)}">
            <div class="anfrage-info">
                <div class="anfrage-name">${escapeHtml(p.voller_name || '-')}</div>
                <div class="anfrage-email mono">${escapeHtml(p.email || '-')}</div>
                <div class="anfrage-meta">
                    Registriert: ${formatDate(p.erstellt_am)}
                </div>
            </div>
            <div class="anfrage-aktionen">
                <button class="btn btn-primary btn-sm"
                        onclick="genehmigeUser('${escapeHtml(p.id)}', 'bediener')">
                    Freigeben als Bediener
                </button>
                <button class="btn btn-secondary btn-sm"
                        onclick="genehmigeUser('${escapeHtml(p.id)}', 'admin')">
                    Freigeben als Admin
                </button>
                <button class="btn btn-secondary btn-sm btn-danger-ghost"
                        onclick="lehneAb('${escapeHtml(p.id)}')">
                    Ablehnen
                </button>
            </div>
        </div>
    `).join('');
}


/**
 * Rendert die Liste der freigegebenen (approved) Benutzer.
 *
 * @param {Array} profile - Array von profile-Objekten mit status='approved'
 */
function renderApprovedListe(profile) {
    const container = document.getElementById('approved-liste');

    if (!profile || profile.length === 0) {
        container.innerHTML =
            '<div class="empty-state">Noch niemand freigegeben.</div>';
        return;
    }

    container.innerHTML = profile.map(p => `
        <div class="anfrage-karte anfrage-karte-approved">
            <div class="anfrage-info">
                <div class="anfrage-name">
                    ${escapeHtml(p.voller_name || '-')}
                    ${p.rolle === 'admin'
                        ? '<span class="badge badge-freigegeben" style="margin-left:8px;">ADMIN</span>'
                        : '<span class="badge badge-konvertiert" style="margin-left:8px;">BEDINER</span>'}
                </div>
                <div class="anfrage-email mono">${escapeHtml(p.email || '-')}</div>
                <div class="anfrage-meta">
                    Freigegeben von ${escapeHtml(p.freigeben_von || '-')} am
                    ${formatDate(p.freigegeben_am)}
                </div>
            </div>
            <div class="anfrage-aktionen">
                ${p.rolle === 'admin'
                    ? `<button class="btn btn-secondary btn-sm"
                            onclick="aendereRolle('${escapeHtml(p.id)}', 'bediener')">
                        Zu Bediener machen
                       </button>`
                    : `<button class="btn btn-secondary btn-sm"
                            onclick="aendereRolle('${escapeHtml(p.id)}', 'admin')">
                        Zu Admin machen
                       </button>`}
                <button class="btn btn-secondary btn-sm btn-danger-ghost"
                        onclick="entzieheFreigabe('${escapeHtml(p.id)}')">
                    Zugriff entziehen
                </button>
            </div>
        </div>
    `).join('');
}


/**
 * Rendert die Liste der abgelehnten (rejected) Anfragen.
 *
 * @param {Array} profile - Array von profile-Objekten mit status='rejected'
 */
function renderRejectedListe(profile) {
    const container = document.getElementById('rejected-liste');

    if (!profile || profile.length === 0) {
        container.innerHTML =
            '<div class="empty-state">Keine abgelehnten Anfragen.</div>';
        return;
    }

    container.innerHTML = profile.map(p => `
        <div class="anfrage-karte anfrage-karte-rejected">
            <div class="anfrage-info">
                <div class="anfrage-name">${escapeHtml(p.voller_name || '-')}</div>
                <div class="anfrage-email mono">${escapeHtml(p.email || '-')}</div>
                <div class="anfrage-meta">
                    Abgelehnt. ${p.abgelehnt_grund
                        ? 'Grund: ' + escapeHtml(p.abgelehnt_grund)
                        : 'Kein Grund angegeben.'}
                </div>
            </div>
            <div class="anfrage-aktionen">
                <button class="btn btn-secondary btn-sm"
                        onclick="genehmigeUser('${escapeHtml(p.id)}', 'bediener')">
                    Doch freigeben (Bediener)
                </button>
            </div>
        </div>
    `).join('');
}


/**
 * Genehmigt eine Anfrage: setzt status auf 'approved' und traegt die Rolle ein.
 *
 * @param {string} profileId - UUID des Profile-Eintrags
 * @param {string} rolle - 'bediener' oder 'admin'
 */
async function genehmigeUser(profileId, rolle) {
    const client = initSupabase();
    if (!client) return;

    // Sicherheits-Check: Rolle validieren
    if (rolle !== 'bediener' && rolle !== 'admin') {
        showMessage('Ungueltige Rolle.', 'error');
        return;
    }

    // Bestaetigung fuer Admin-Freigabe (zusaetzliche Huerde)
    if (rolle === 'admin') {
        const ok = confirm(
            'Soll diese Person wirklich ADMIN-Rechte bekommen?\n' +
            'Admins koennen Produkte aendern und andere User verwalten.'
        );
        if (!ok) return;
    }

    // Aktuelle Admin-E-Mail fuer Audit
    const { data: { session } } = await client.auth.getSession();
    const adminEmail = session?.user?.email || 'unbekannt';

    // Profile aktualisieren
    const { error } = await client
        .from('profile')
        .update({
            status: 'approved',
            rolle: rolle,
            freigegeben_von: adminEmail,
            freigegeben_am: new Date().toISOString(),
            abgelehnt_grund: null
        })
        .eq('id', profileId);

    if (error) {
        showMessage('Fehler beim Freigeben: ' + error.message, 'error');
        return;
    }

    showMessage('Benutzer freigegeben als ' + rolle + '.', 'success');

    // Listen neu laden
    await loadAnfragen();
    // Badge im Header aktualisieren
    await ladeAdminHeader(session);
}


/**
 * Lehnt eine Anfrage ab: setzt status auf 'rejected'.
 *
 * @param {string} profileId - UUID des Profile-Eintrags
 */
async function lehneAb(profileId) {
    const client = initSupabase();
    if (!client) return;

    // Optionaler Grund (prompt bietet ein kleines Eingabefeld)
    const grund = prompt(
        'Grund fuer die Ablehnung (optional, wird im Admin-UI gespeichert):',
        ''
    );
    // null = "Abbrechen" geklickt -> nichts tun
    if (grund === null) return;

    const { data: { session } } = await client.auth.getSession();
    const adminEmail = session?.user?.email || 'unbekannt';

    const { error } = await client
        .from('profile')
        .update({
            status: 'rejected',
            abgelehnt_grund: grund || null,
            rolle: null,
            freigegeben_von: adminEmail,
            freigegeben_am: new Date().toISOString()
        })
        .eq('id', profileId);

    if (error) {
        showMessage('Fehler beim Ablehnen: ' + error.message, 'error');
        return;
    }

    showMessage('Anfrage abgelehnt.', 'info');

    await loadAnfragen();
    await ladeAdminHeader(session);
}


/**
 * Aendert die Rolle eines bereits freigegebenen Benutzers.
 *
 * @param {string} profileId - UUID des Profile-Eintrags
 * @param {string} neueRolle - 'bediener' oder 'admin'
 */
async function aendereRolle(profileId, neueRolle) {
    const client = initSupabase();
    if (!client) return;

    if (neueRolle === 'admin') {
        const ok = confirm(
            'Soll diese Person wirklich ADMIN-Rechte bekommen?\n' +
            'Admins koennen Produkte aendern und andere User verwalten.'
        );
        if (!ok) return;
    }

    const { error } = await client
        .from('profile')
        .update({ rolle: neueRolle })
        .eq('id', profileId);

    if (error) {
        showMessage('Fehler beim Aendern der Rolle: ' + error.message, 'error');
        return;
    }

    showMessage('Rolle geaendert zu: ' + neueRolle, 'success');
    await loadAnfragen();
}


/**
 * Entzieht einem freigegebenen Benutzer den Zugriff (zurueck auf pending).
 * Loescht den User nicht - er kann sich weiter einloggen, sieht aber
 * wieder den "Warte auf Freigabe"-Hinweis.
 *
 * @param {string} profileId - UUID des Profile-Eintrags
 */
async function entzieheFreigabe(profileId) {
    const client = initSupabase();
    if (!client) return;

    const ok = confirm(
        'Möchtest du den Zugriff wirklich entziehen?\n' +
        'Der Benutzer kann sich weiter einloggen, sieht aber keine Daten mehr.'
    );
    if (!ok) return;

    const { error } = await client
        .from('profile')
        .update({
            status: 'pending',
            rolle: null
        })
        .eq('id', profileId);

    if (error) {
        showMessage('Fehler: ' + error.message, 'error');
        return;
    }

    showMessage('Zugriff entzogen. Benutzer ist wieder pending.', 'info');
    await loadAnfragen();
}


// =====================================================================
// 7. SEITEN-INITIALISIERUNG (wird beim Laden jeder Seite aufgerufen)
// =====================================================================

/**
 * Wird aufgerufen, wenn die Seite geladen ist.
 * Erkennt anhand des body-tags, welche Seite geladen ist, und
 * fuehrt die entsprechende Initialisierung aus.
 */
document.addEventListener('DOMContentLoaded', async () => {
    const page = document.body.getAttribute('data-page');

    switch (page) {
        case 'login':
            // Login-Seite: Focus aufs E-Mail-Feld
            document.getElementById('email')?.focus();
            break;

        case 'register':
            // Registrierungs-Seite: Focus aufs Namens-Feld
            document.getElementById('voller-name')?.focus();
            break;

        case 'produkte':
            // Produktliste: Session pruefen, dann Produkte laden
            const session = await checkAuth();
            if (session) {
                displayUserInfo(session);
                // Admin-Badge im Header laden (nur sichtbar wenn Admin)
                await ladeAdminHeader(session);
                await loadProdukte();
            }
            break;

        case 'detail':
            // Detailseite: Session pruefen, dann Details laden
            const detSession = await checkAuth();
            if (detSession) {
                displayUserInfo(detSession);
                await ladeAdminHeader(detSession);
                await loadDetail();
            }
            break;

        case 'anfragen':
            // Anfragen-Seite (Admin): Session pruefen, dann Anfragen laden
            const anfrSession = await checkAuth();
            if (anfrSession) {
                displayUserInfo(anfrSession);
                await ladeAdminHeader(anfrSession);
                await loadAnfragen();
            }
            break;
    }
});
