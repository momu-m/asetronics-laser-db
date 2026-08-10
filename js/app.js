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

    // Anmelden
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

    // Erfolg -> zur Produktliste
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
 * Rendert die Produkt-Tabelle.
 * @param {Array} produkte - Array von Produkt-Objekten
 */
function renderProdukteTabelle(produkte) {
    const tbody = document.getElementById('produkte-table-body');

    if (!produkte || produkte.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="6" class="empty-state">Keine Programme gefunden.</td></tr>';
        return;
    }

    // HTML fuer jede Zeile generieren.
    // WICHTIG: Alle Datenbank-Werte werden durch escapeHtml() gesichert,
    //          damit kein boeser Code (XSS) ausgefuehrt werden kann.
    tbody.innerHTML = produkte.map(p => `
        <tr class="clickable produkte-row"
            data-produkt-id="${escapeHtml(p.id)}">
            <td><strong>${escapeHtml(p.bezeichnung)}</strong></td>
            <td class="mono">${escapeHtml(p.ase_materialnr) || '-'}</td>
            <td>${escapeHtml(p.material) || '-'}</td>
            <td class="numeric">
                ${p.xsize ? formatNumber(p.xsize) + ' &times; ' +
                            formatNumber(p.ysize) + ' &times; ' +
                            formatNumber(p.zsize) + ' mm' : '-'}
            </td>
            <td>
                <span class="${getStatusBadgeClass(p.status)}">${escapeHtml(p.status)}</span>
            </td>
            <td>${formatDate(p.erstellt_am)}</td>
        </tr>
    `).join('');

    // Event-Listener statt onclick (XSS-Sicherheit nach MiniMax-Review K4).
    tbody.querySelectorAll('.produkte-row').forEach(row => {
        row.addEventListener('click', function() {
            const id = this.getAttribute('data-produkt-id');
            window.location.href = 'detail.html?id=' + encodeURIComponent(id);
        });
    });
}

/**
 * Filtert die Produktliste nach Suchbegriff und Status.
 * Wird bei jeder Aenderung der Filter aufgerufen.
 */
function filterProdukte() {
    const suchbegriff = document.getElementById('suche').value.toLowerCase();
    const statusFilter = document.getElementById('status-filter').value;

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

    renderProdukteTabelle(gefiltert);
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

        case 'produkte':
            // Produktliste: Session pruefen, dann Produkte laden
            const session = await checkAuth();
            if (session) {
                displayUserInfo(session);
                await loadProdukte();
            }
            break;

        case 'detail':
            // Detailseite: Session pruefen, dann Details laden
            const detSession = await checkAuth();
            if (detSession) {
                displayUserInfo(detSession);
                await loadDetail();
            }
            break;
    }
});
