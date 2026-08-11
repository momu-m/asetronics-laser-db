// =====================================================================
// ALPA - Qualifikations-Plan / Ruest-Assistent (qualifikation.js)
// =====================================================================
// Zweck:  Laedt die 25 Produkte aus der Tabelle "qualification" und
//         zeigt sie als filterbare, sortierbare Tabelle. Bei Klick auf
//         "Details" oeffnet sich ein Modal mit:
//           - Produktdaten (Material, Werk, DMC-Struktur, Stueckzahl)
//           - DMC-Uebersetzung (welche Laser-3-Variable wird empfohlen)
//           - Schritt-fuer-Schritt Einfahr-Checkliste
//
// Abhaengigkeiten: app.js (initSupabase, checkAuth, displayUserInfo,
//                  ladeAdminHeader, isAdmin, escapeHtml, showMessage)
//
// Session 7 (11.08.2026): Neues Modul, eigenstaendig neben app.js und
//                         rechner.js. Greift LESEND auf die Tabelle
//                         "qualification" zu.
// =====================================================================


// Globaler Zustand: alle geladenen Produkte und aktuelle Sortierung
window.alleQualifikationen = [];
let sortierung = { spalte: 'excel_zeilen_nr', aufsteigend: true };
let istAdmin = false;


// =====================================================================
// 0. INITIALISIERUNG (beim Laden der Seite)
// =====================================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Login pruefen
    const session = await checkAuth();
    if (!session) return;

    // Header-Info anzeigen
    displayUserInfo(session);
    await ladeAdminHeader(session);

    // Admin-Status fuer spaetere Aktionen merken
    istAdmin = await istAdminBenutzer();

    // Daten laden
    await ladeQualifikationen();
});


// =====================================================================
// 1. DATEN LADEN (aus Supabase-Tabelle "qualification")
// =====================================================================

async function ladeQualifikationen() {
    const client = initSupabase();
    if (!client) return;

    const tbody = document.getElementById('qualifikation-body');
    if (!tbody) return;

    try {
        // Lese alle 25 Produkte, sortiert nach Excel-Zeilen-Nummer
        const { data, error } = await client
            .from('qualification')
            .select('*')
            .order('excel_zeilen_nr', { ascending: true });

        if (error) throw error;

        window.alleQualifikationen = data || [];

        // Zusammenfassung aktualisieren
        aktualisiereStats();

        // Tabelle zeichnen
        zeigeQualifikationen();
    } catch (fehler) {
        console.error('Fehler beim Laden der Qualifikation:', fehler);
        tbody.innerHTML =
            '<tr><td colspan="9" class="error-row">' +
            'Fehler beim Laden: ' + escapeHtml(fehler.message || fehler) +
            '<br><br>Hinweis: Falls die Tabelle leer ist, muessen die SQL-Skripte ' +
            '11_qualification_tabelle.sql und 12_seed_qualification.sql ' +
            'im Supabase-Editor ausgefuehrt werden.</td></tr>';
    }
}


// =====================================================================
// 2. STATS (Zusammenfassung der Status-Verteilung)
// =====================================================================

function aktualisiereStats() {
    const alle = window.alleQualifikationen;
    const zaehle = (status) => alle.filter(p => p.einfahrstatus === status).length;

    document.getElementById('stat-eingefahren').textContent = zaehle('eingefahren');
    document.getElementById('stat-programmiert').textContent = zaehle('programmiert');
    document.getElementById('stat-offen').textContent =
        zaehle('offen') + zaehle('in_pruefung');
    document.getElementById('stat-total').textContent = alle.length;
}


// =====================================================================
// 3. TABELLE ZEICHNEN (mit Filter)
// =====================================================================

function zeigeQualifikationen() {
    const tbody = document.getElementById('qualifikation-body');
    if (!tbody) return;

    // Filter anwenden
    const gefiltert = filtereDaten(window.alleQualifikationen);

    if (gefiltert.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="9" class="empty-row">' +
            'Keine Produkte gefunden fuer diesen Filter.</td></tr>';
        return;
    }

    // Sortierung anwenden
    const sortiert = [...gefiltert].sort((a, b) => {
        let wertA = a[sortierung.spalte] || '';
        let wertB = b[sortierung.spalte] || '';

        // Zahlen numerisch sortieren
        if (typeof wertA === 'number' && typeof wertB === 'number') {
            return sortierung.aufsteigend ? wertA - wertB : wertB - wertA;
        }

        // Datumsangaben sortieren
        if (sortierung.spalte === 'einfahrdatum') {
            wertA = new Date(wertA || '1900-01-01').getTime();
            wertB = new Date(wertB || '1900-01-01').getTime();
            return sortierung.aufsteigend ? wertA - wertB : wertB - wertA;
        }

        // Text sortieren
        const txtA = String(wertA).toLowerCase();
        const txtB = String(wertB).toLowerCase();
        if (txtA < txtB) return sortierung.aufsteigend ? -1 : 1;
        if (txtA > txtB) return sortierung.aufsteigend ? 1 : -1;
        return 0;
    });

    // Zeilen rendern
    tbody.innerHTML = sortiert.map(p => erzeugeZeile(p)).join('');
}


// =====================================================================
// 4. FILTER (Suche + Status + Material + Werk)
// =====================================================================

function filtereDaten(daten) {
    const suchbegriff = (document.getElementById('suche-quali')?.value || '').toLowerCase();
    const statusFilter = document.getElementById('status-filter-quali')?.value || '';
    const materialFilter = document.getElementById('material-filter-quali')?.value || '';
    const werkFilter = document.getElementById('werk-filter-quali')?.value || '';

    return daten.filter(p => {
        // Suchfilter (Bezeichnung oder ASE-Nummer)
        if (suchbegriff) {
            const text = (
                (p.bezeichnung || '') + ' ' +
                (p.ase_materialnr || '') + ' ' +
                (p.hella_plant || '') + ' ' +
                (p.bemerkung || '')
            ).toLowerCase();
            if (!text.includes(suchbegriff)) return false;
        }

        // Status-Filter
        if (statusFilter && p.einfahrstatus !== statusFilter) return false;

        // Material-Filter
        if (materialFilter && p.material !== materialFilter) return false;

        // Werk-Filter (Teilstring-Match, weil Werke leicht variieren)
        if (werkFilter && !(p.hella_plant || '').includes(werkFilter)) return false;

        return true;
    });
}


// Filter-Trigger (wird von den Eingabefeldern im HTML aufgerufen)
function filterQualifikation() {
    zeigeQualifikationen();
}


// =====================================================================
// 5. SORTIERUNG (bei Klick auf Spalten-Ueberschrift)
// =====================================================================

function sortiereQualifikation(spalte) {
    if (sortierung.spalte === spalte) {
        // Gleiche Spalte: Richtung umkehren
        sortierung.aufsteigend = !sortierung.aufsteigend;
    } else {
        sortierung.spalte = spalte;
        sortierung.aufsteigend = true;
    }
    zeigeQualifikationen();
}


// =====================================================================
// 6. ZEILE ERZEUGEN (eine Zeile pro Produkt)
// =====================================================================

function erzeugeZeile(p) {
    // Status-Badge ermitteln
    const badgeKlasse = erzeugeStatusBadgeKlasse(p.einfahrstatus);

    // DMC-Struktur gekuerzt anzeigen (kann sehr lang sein)
    const dmcKurz = (p.dmc_content || '')
        .replace(/<[^>]+>/g, '')   // Tags entfernen
        .slice(0, 30) + ((p.dmc_content || '').length > 30 ? '...' : '');

    // Datum formatieren
    const datumFormatiert = p.einfahrdatum
        ? new Date(p.einfahrdatum).toLocaleDateString('de-CH')
        : '-';

    return `
        <tr onclick="oeffneDetailModal('${p.id}')" style="cursor:pointer;">
            <td class="mono">${escapeHtml(p.excel_zeilen_nr || '')}</td>
            <td><strong>${escapeHtml(p.bezeichnung || '')}</strong></td>
            <td class="mono">${escapeHtml(p.ase_materialnr || '')}</td>
            <td>${escapeHtml(p.material || '-')}</td>
            <td>${escapeHtml(kuerzeWerk(p.hella_plant))}</td>
            <td class="mono" style="font-size:11px;">${escapeHtml(dmcKurz || '-')}</td>
            <td>${datumFormatiert}</td>
            <td>${erzeugeStatusBadgeFuerTabelle(p, badgeKlasse)}</td>
            <td>
                <button class="btn btn-primary btn-sm" onclick="event.stopPropagation(); oeffneDetailModal('${p.id}');">
                    Details
                </button>
            </td>
        </tr>
    `;
}


// Status-Badge-Klasse basierend auf einfahrstatus
function erzeugeStatusBadgeKlasse(status) {
    switch (status) {
        case 'eingefahren':  return 'badge-success';
        case 'programmiert': return 'badge-info';
        case 'offen':        return 'badge-warning';
        case 'in_pruefung':  return 'badge-info';
        case 'abgeschlossen':return 'badge-success';
        case 'abgelehnt':    return 'badge-error';
        default:             return 'badge-default';
    }
}


// Erzeugt das Badge fuer die Tabellen-Zeile. Bei Admins ist es klickbar
// (zyklischer Wechsel: offen -> programmiert -> eingefahren).
function erzeugeStatusBadgeFuerTabelle(p, badgeKlasse) {
    const status = escapeHtml(p.einfahrstatus || '-');
    if (istAdmin) {
        // Klickbar fuer Admins: beim Klick auf das Badge zyklisch weiter schalten
        return `<span class="badge ${badgeKlasse}" ` +
               `onclick="schnellWechselStatus('${p.id}', event)" ` +
               `style="cursor:pointer; user-select:none;" ` +
               `title="Klick zum Wechseln: offen -> programmiert -> eingefahren">` +
               `${status}</span>`;
    }
    return `<span class="badge ${badgeKlasse}">${status}</span>`;
}


// Werk-Namen kuerzen fuer bessere Lesbarkeit in der Tabelle
function kuerzeWerk(werk) {
    if (!werk) return '-';
    return werk
        .replace('Hella Automotive ', 'PL')
        .replace('Hella Slovakia ', 'SK ')
        .replace('Hella Autotechnik Nova s.r.o', 'Nova')
        .replace('Hella Slovenija', 'SLO')
        .replace('Hella GmbH & Co. KGaA', 'GmbH');
}


// =====================================================================
// 7. DETAIL-MODAL (Einfahr-Checkliste und DMC-Empfehlung)
// =====================================================================

function oeffneDetailModal(id) {
    const p = window.alleQualifikationen.find(x => x.id === id);
    if (!p) return;

    const modal = document.getElementById('detail-modal');
    const body = document.getElementById('detail-modal-body');
    const titel = document.getElementById('modal-titel');

    titel.textContent = p.bezeichnung + ' - Einfahr-Details';

    // DMC-Muster fuer die Uebersetzung ableiten
    const dmcInfo = analysiereDmcStruktur(p.dmc_content);

    body.innerHTML = `
        <div class="detail-grid">

            <!-- Produktdaten -->
            <div class="card">
                <div class="card-title">Produktdaten</div>
                <table class="detail-tabelle">
                    <tr><td>ASE-Materialnummer</td><td class="mono">${escapeHtml(p.ase_materialnr || '-')}</td></tr>
                    <tr><td>Bezeichnung</td><td><strong>${escapeHtml(p.bezeichnung || '-')}</strong></td></tr>
                    <tr><td>Material</td><td>${escapeHtml(p.material || '-')}</td></tr>
                    <tr><td>Lackierung</td><td>${escapeHtml(p.lacquer || '-')}</td></tr>
                    <tr><td>Hella-Werk</td><td>${escapeHtml(p.hella_plant || '-')}</td></tr>
                    <tr><td>Nutzen</td><td>${escapeHtml(p.nutzen || '-')}</td></tr>
                    <tr><td>Jahresstueckzahl</td><td>${escapeHtml(p.stueckzahl || '-')}</td></tr>
                    <tr><td>DMC-Dokument</td><td class="mono">${escapeHtml(p.dmc_dokument || '-')}</td></tr>
                    <tr><td>Einfahrdatum</td><td>${p.einfahrdatum ? new Date(p.einfahrdatum).toLocaleDateString('de-CH') : '-'}</td></tr>
                    <tr><td>Status</td><td>${erzeugeStatusAnzeige(p)}</td></tr>
                    ${p.bemerkung ? `<tr><td>Bemerkung</td><td>${escapeHtml(p.bemerkung)}</td></tr>` : ''}
                </table>
            </div>

            <!-- Status-Aendern-Karte (nur fuer Admins) -->
            ${istAdmin ? `
            <div class="card" style="grid-column: 1 / -1;">
                <div class="card-title">Status aendern (nur Admin)</div>
                <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
                    <select id="status-dropdown-${p.id}" class="toolbar-select" style="min-width:220px;">
                        <option value="offen" ${p.einfahrstatus === 'offen' ? 'selected' : ''}>Offen</option>
                        <option value="programmiert" ${p.einfahrstatus === 'programmiert' ? 'selected' : ''}>Programmiert</option>
                        <option value="in_pruefung" ${p.einfahrstatus === 'in_pruefung' ? 'selected' : ''}>In Pruefung</option>
                        <option value="eingefahren" ${p.einfahrstatus === 'eingefahren' ? 'selected' : ''}>Eingefahren</option>
                        <option value="abgeschlossen" ${p.einfahrstatus === 'abgeschlossen' ? 'selected' : ''}>Abgeschlossen</option>
                        <option value="abgelehnt" ${p.einfahrstatus === 'abgelehnt' ? 'selected' : ''}>Abgelehnt</option>
                    </select>
                    <button class="btn btn-primary btn-sm" onclick="speichereStatus('${p.id}')">
                        Status speichern
                    </button>
                    <span id="status-feedback-${p.id}" style="font-size:12px; color:var(--as-text-muted);"></span>
                </div>
            </div>
            ` : ''}

            <!-- DMC-Empfehlung -->
            <div class="card">
                <div class="card-title">DMC-Struktur und Empfehlung</div>
                <p style="font-size:13px; margin-bottom:8px;">
                    Original-Spezifikation laut Hella-Definition:
                </p>
                <code class="dmc-cleartext" style="display:block; margin-bottom:16px; font-size:11px;">
                    ${escapeHtml(p.dmc_content || 'Keine DMC-Struktur hinterlegt')}
                </code>

                ${dmcInfo ? `
                    <p style="font-size:13px; margin-bottom:8px;">
                        Empfohlene Laser-3-Composite-Variable:
                    </p>
                    <div class="dmc-result-value" style="margin-bottom:8px;">
                        ${escapeHtml(dmcInfo.composite)}
                    </div>
                    <p style="font-size:12px; color:var(--as-text-muted);">
                        ${escapeHtml(dmcInfo.beschreibung)}
                    </p>
                    ${dmcInfo.warnung ? `
                        <div class="alert alert-error" style="margin-top:8px; font-size:12px;">
                            ${escapeHtml(dmcInfo.warnung)}
                        </div>
                    ` : ''}
                    <p style="margin-top:12px;">
                        <a href="rechner.html" class="btn btn-secondary btn-sm">
                            Im Rechner konfigurieren
                        </a>
                    </p>
                ` : ''}
            </div>

            <!-- Einfahr-Checkliste -->
            <div class="card" style="grid-column: 1 / -1;">
                <div class="card-title">Einfahr-Checkliste fuer Laser 3</div>
                <p style="font-size:13px; margin-bottom:12px;">
                    Diese Schritte muessen pro Produkt im Simplex-Editor
                    auf Laser 3 durchgefuehrt werden. Basiert auf der
                    Anleitung "Label und Variable selbst einstellen".
                </p>
                <ol class="einfahr-checkliste">
                    ${erzeugeEinfahrCheckliste(p).map(s => `
                        <li>
                            <input type="checkbox" class="einfahr-checkbox" data-schritt="${s.nr}" data-produkt="${p.id}">
                            <div>
                                <strong>${escapeHtml(s.titel)}</strong><br>
                                <span style="font-size:12px; color:var(--as-text-muted);">${escapeHtml(s.detail)}</span>
                            </div>
                        </li>
                    `).join('')}
                </ol>
                <p style="font-size:12px; color:var(--as-text-muted); margin-top:12px;">
                    Hinweis: Die Checkboxen sind nur fuer die lokale Uebersicht
                    und werden nicht gespeichert. Nutze den Status (oben) fuer
                    die dauerhafte Verfolgung.
                </p>
            </div>

        </div>
    `;

    modal.style.display = 'flex';
}


function schliesseDetailModal() {
    document.getElementById('detail-modal').style.display = 'none';
}


// =====================================================================
// 7b. STATUS-AENDERUNG (nur fuer Admins)
// =====================================================================

// Erzeugt die Status-Anzeige: fuer Nicht-Admins nur ein Badge (lesen),
// fuer Admins erscheint zusaetzlich die Aendern-Karte weiter unten.
function erzeugeStatusAnzeige(p) {
    const badgeKlasse = erzeugeStatusBadgeKlasse(p.einfahrstatus);
    let html = `<span class="badge ${badgeKlasse}">${escapeHtml(p.einfahrstatus || '-')}</span>`;
    if (istAdmin) {
        html += ' <span style="font-size:11px; color:var(--as-text-muted); margin-left:6px;">' +
                '(Aenderung unten moeglich)</span>';
    }
    return html;
}


// Speichert den neuen Status in der Datenbank.
// Wird vom Button "Status speichern" im Detail-Modal aufgerufen.
async function speichereStatus(produktId) {
    const client = initSupabase();
    if (!client) return;

    // Sicherheitscheck: nur Admins duerfen aendern
    if (!istAdmin) {
        zeigeStatusFeedback(produktId, 'Nur Admins duerfen den Status aendern.', true);
        return;
    }

    // Gewaehlten Wert aus dem Dropdown lesen
    const dropdown = document.getElementById('status-dropdown-' + produktId);
    if (!dropdown) return;
    const neuerStatus = dropdown.value;

    const feedback = document.getElementById('status-feedback-' + produktId);
    if (feedback) {
        feedback.textContent = 'Speichere...';
        feedback.style.color = 'var(--as-text-muted)';
    }

    try {
        // Update in der qualification-Tabelle
        const { error } = await client
            .from('qualification')
            .update({
                einfahrstatus: neuerStatus,
                // Wenn Status auf eingefahren/abgeschlossen gesetzt wird,
                // und kein Datum existiert, setzen wir es auf heute.
                einfahrdatum: (neuerStatus === 'eingefahren' || neuerStatus === 'abgeschlossen')
                    ? new Date().toISOString().split('T')[0]
                    : undefined
            })
            .eq('id', produktId);

        if (error) throw error;

        // Lokale Daten aktualisieren (damit Tabelle sofort passt)
        const idx = window.alleQualifikationen.findIndex(x => x.id === produktId);
        if (idx >= 0) {
            window.alleQualifikationen[idx].einfahrstatus = neuerStatus;
        }

        // UI aktualisieren: Stats, Tabelle, und Badge im Modal
        aktualisiereStats();
        zeigeQualifikationen();

        // Status-Badge oben im Modal direkt ersetzen (ohne kompletten Reload)
        // Wir aktualisieren nur die sichtbare Status-Anzeige durch Neu-Oeffnen.
        if (feedback) {
            feedback.textContent = 'Gespeichert: ' + neuerStatus;
            feedback.style.color = '#2A9D5C';
        }

        // Nach kurzer Pause das Modal aktualisieren, damit das neue Badge sichtbar wird
        setTimeout(() => oeffneDetailModal(produktId), 800);
    } catch (fehler) {
        console.error('Fehler beim Speichern des Status:', fehler);
        if (feedback) {
            feedback.textContent = 'Fehler: ' + (fehler.message || fehler);
            feedback.style.color = '#C0392B';
        }
    }
}


// Hilfsfunktion: kurzes Feedback anzeigen
function zeigeStatusFeedback(produktId, text, istFehler) {
    const feedback = document.getElementById('status-feedback-' + produktId);
    if (feedback) {
        feedback.textContent = text;
        feedback.style.color = istFehler ? '#C0392B' : 'var(--as-text-muted)';
    }
}


// =====================================================================
// 7c. SCHNELL-STATUS-WECHSEL direkt in der Tabelle (fuer Admins)
// =====================================================================
// Wird beim Klick auf das Badge in der Tabellen-Zeile aufgerufen.
// Schaltet den Status zyklisch weiter: offen -> programmiert -> eingefahren -> offen

async function schnellWechselStatus(produktId, event) {
    // Klick stoppen, sonst oeffnet sich das Modal
    if (event) event.stopPropagation();

    // Nur Admins
    if (!istAdmin) return;

    const client = initSupabase();
    if (!client) return;

    // Aktuelles Produkt finden
    const p = window.alleQualifikationen.find(x => x.id === produktId);
    if (!p) return;

    // Zyklischer Wechsel: offen -> programmiert -> eingefahren -> offen
    const zyklus = ['offen', 'programmiert', 'eingefahren'];
    const aktuell = p.einfahrstatus || 'offen';
    const aktuellerIndex = zyklus.indexOf(aktuell);
    // Falls Status nicht im Zyklus (z.B. in_pruefung), fangen wir bei 'offen' an
    const naechsterIndex = aktuellerIndex >= 0 ? (aktuellerIndex + 1) % zyklus.length : 0;
    const neuerStatus = zyklus[naechsterIndex];

    try {
        const { error } = await client
            .from('qualification')
            .update({ einfahrstatus: neuerStatus })
            .eq('id', produktId);

        if (error) throw error;

        // Lokale Daten aktualisieren
        const idx = window.alleQualifikationen.findIndex(x => x.id === produktId);
        if (idx >= 0) {
            window.alleQualifikationen[idx].einfahrstatus = neuerStatus;
        }

        aktualisiereStats();
        zeigeQualifikationen();
    } catch (fehler) {
        console.error('Fehler beim Status-Wechsel:', fehler);
        alert('Fehler beim Speichern: ' + (fehler.message || fehler));
    }
}


// =====================================================================
// 8. EINFAR-CHECKLISTE (Schritte fuer das Einfahren auf Laser 3)
// =====================================================================

function erzeugeEinfahrCheckliste(p) {
    const schritte = [];
    const dmcInfo = analysiereDmcStruktur(p.dmc_content);

    schritte.push({
        nr: 1,
        titel: 'Programm in Simplex laden',
        detail: 'Die vom Konverter erzeugte .PROGRAM- und .PRODUCTLAYOUT-Datei ' +
                'nach NewAsysXMLBase/Global/Data/Programs/ bzw. Products/ kopieren. ' +
                'In Simplex oeffnen und pruefen, ob alle Positionen sichtbar.'
    });

    schritte.push({
        nr: 2,
        titel: 'Label fuer jede Position waehlen',
        detail: 'Je nach DMC-Laenge das passende Label waehlen. ' +
                '19 Zeichen: DMC-35mm-16x16-19alphanum. ' +
                '20-22 Zeichen: DMC-35mm-16x16-22alphanum. ' +
                '23-24 Zeichen: DMC-55mm-18x18-24alphanum. ' +
                'Spezial: HELLAcode2D5,5mmOnlineWWYY fuer VW-Produkte mit Datum.'
    });

    schritte.push({
        nr: 3,
        titel: 'Variable (Code-Inhalt) konfigurieren',
        detail: dmcInfo
            ? 'Composite-Variable "' + dmcInfo.composite + '" anlegen. ' +
              'CLEARTEXT-Formel: ' + dmcInfo.cleartext
            : 'Variable passend zur DMC-Struktur konfigurieren. ' +
              'Im Rechner (Tab DMC-Uebersetzer) die genaue Konfiguration abrufen.'
    });

    schritte.push({
        nr: 4,
        titel: 'ParamSet fuer MarkPosition waehlen',
        detail: 'Im Feld ParamSet den Wert "default_1" eintragen. ' +
                'Achtung: Laser-Parameter (Geschwindigkeit, Leistung, Frequenz) ' +
                'muessen in SCAPS separat pro Material eingestellt werden.'
    });

    schritte.push({
        nr: 5,
        titel: 'ParamSet fuer Fiducials waehlen',
        detail: 'Falls das Produkt Fiducials hat, zusaetzlich das passende ' +
                'Fiducial-ParamSet eintragen und die Fiducial-Koordinaten pruefen.'
    });

    schritte.push({
        nr: 6,
        titel: 'Fiducial-Koordinaten eintragen',
        detail: 'Die XY-Koordinaten der Fiducials aus dem Original-Programm ' +
                'uebernehmen. Der Konverter uebernimmt sie 1:1, aber zur ' +
                'Sicherheit gegenpruefen.'
    });

    schritte.push({
        nr: 7,
        titel: 'Testlasern durchfuehren',
        detail: 'Erste Testlasung auf einem Muster-Stueck durchfuehren. ' +
                'DMC mit Lesegeraet (Keyence) oder Messschieber pruefen: ' +
                'Ist der Code lesbar? Stimmt die Position? ' +
                'Achtung: Optik/Kalibrierung kann systematische Verschiebungen erzeugen.'
    });

    schritte.push({
        nr: 8,
        titel: 'RELEASED=1 setzen (freigeben)',
        detail: 'Nach erfolgreicher Testlasung das Programm im Simplex ' +
                'freigeben (RELEASED=1). Danach ist es fuer die Produktion verfuegbar.'
    });

    return schritte;
}


// =====================================================================
// 9. DMC-STRUKTUR ANALYSIEREN (fuer die Empfehlung im Modal)
// =====================================================================
// Vereinfachte Version der Logik aus rechner.js. Wir brauchen hier keine
// vollstaendige Berechnung, sondern nur die Empfehlung fuer die Anzeige.

function analysiereDmcStruktur(dmcContent) {
    if (!dmcContent) return null;

    // Bausteine aus dem DMC-Content extrahieren
    const hatPartNr = dmcContent.includes('part-nr');
    const hatSerial = dmcContent.includes('serial');
    const hatRev = dmcContent.includes('revision');
    const hatBinning = dmcContent.includes('binning');
    const hatDatum = dmcContent.includes('production date') || dmcContent.includes('WWYY');
    const hatPlant = dmcContent.includes('plant location');

    // Composite-Variable ableiten
    let composite = 'rawcode-single';
    let cleartext = '[fmtKundenText][serial][customerPartIndex][binning]';
    let beschreibung = 'Standard-DMC fuer Einzellayouts';
    let warnung = null;

    if (hatPlant) {
        composite = 'rawcode-single-PLANT';
        cleartext = '[fmtKundenText][serial][customerPartIndex][binning][plantLocation]';
        beschreibung = 'DMC mit Werksstandort (BM080-Serie)';
    } else if (hatDatum && hatPartNr) {
        composite = 'rawcode-single-WWYY';
        cleartext = '[fmtKundenText][serial][customerPartIndex][binning][rawcode-single-YYWW_DATE]';
        beschreibung = 'Standard-DMC mit Datum (Jahr+Woche)';
    } else if (hatDatum && !hatPartNr) {
        composite = 'rawcode-single-WWYY';
        cleartext = '[serial][customerPartIndex][binning][rawcode-single-YYWW_DATE]';
        beschreibung = 'DMC mit Datum, aber OHNE part-nr (Spezialfall VW055-00)';
        warnung = 'Achtung: Dieses Produkt hat KEINE part-nr im DMC. ' +
                  'Die Standard-Composite-Variablen erwarten aber fmtKundenText. ' +
                  'Eine eigene Composite-Variante ohne fmtKundenText muss angelegt werden.';
    }

    return { composite, cleartext, beschreibung, warnung };
}


// =====================================================================
// 10. ADMIN-STATUS PRUEFEN (Hilfsfunktion)
// =====================================================================

async function istAdminBenutzer() {
    try {
        // Prueft ob die globale Funktion isAdmin aus app.js existiert
        if (typeof isAdmin === 'function') {
            return await isAdmin();
        }
    } catch (e) {
        console.warn('Admin-Check fehlgeschlagen:', e);
    }
    return false;
}


// =====================================================================
// 11. ESC-Taste schliesst Modal
// =====================================================================

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        schliesseDetailModal();
    }
});

// Klick auf Overlay (ausserhalb des Fensters) schliesst Modal
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('detail-modal');
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                schliesseDetailModal();
            }
        });
    }
});
