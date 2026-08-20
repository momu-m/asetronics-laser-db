// =====================================================================
// ALPA - Variablen-Seite (variablen.html)
// =====================================================================
// Zweck:  Zeigt pro Produkt die DMC-Variable von Laser 1/2 (Name und
//         Inhalt) und die Empfehlung, welche Laser-3-Variable passt.
//
// Daten:  variablen.json (statisch, erzeugt am 21.08.2026 aus der
//         Analyse der Original-Quelldateien von Laser 1 und 2).
//
// Aufbau:
//   1. Login pruefen (wie auf allen Seiten)
//   2. variablen.json laden
//   3. Massstab-, Baustein- und Gruppen-Tabellen fuellen
//   4. Produkt-Tabelle mit Suche und Filter
// =====================================================================

// Alle Produkte aus der JSON-Datei (nach dem Laden gefuellt)
let variablenDaten = [];

// =====================================================================
// 1. SEITE INITIALISIEREN
// =====================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // Login pruefen (leitet bei fehlender Session zur Login-Seite)
    const session = await checkAuth();
    if (session) {
        displayUserInfo(session);
        await ladeAdminHeader(session);
        await ladeVariablenDaten();
    }
});

// =====================================================================
// 2. DATEN LADEN
// =====================================================================
async function ladeVariablenDaten() {
    try {
        const antwort = await fetch('variablen.json');
        if (!antwort.ok) {
            throw new Error('HTTP ' + antwort.status);
        }
        variablenDaten = await antwort.json();
        renderStats();
        renderMassstab();
        renderBausteine();
        renderGruppen();
        renderTabelle(variablenDaten.produkte);
    } catch (err) {
        console.error('variablen.json nicht ladbar:', err);
        document.getElementById('variablen-body').innerHTML =
            '<tr><td colspan="6" class="loading-row">Fehler beim Laden: ' +
            err.message + '</td></tr>';
    }
}

// =====================================================================
// 3. STATISTIK-KARTEN
// =====================================================================
function renderStats() {
    const p = variablenDaten.produkte;
    let single = 0, wwyy = 0, pruefen = 0;
    for (const x of p) {
        if (x.empfehlung === 'rawcode-single') single++;
        else if (x.empfehlung === 'rawcode-single-WWYY') wwyy++;
        else if (x.empfehlung.startsWith('rawcode-single-WWYY +')) wwyy++;
        else pruefen++;
    }
    document.getElementById('stat-single').textContent = single;
    document.getElementById('stat-wwyy').textContent = wwyy;
    document.getElementById('stat-pruefen').textContent = pruefen;
    document.getElementById('stat-total').textContent = p.length;
}

// =====================================================================
// 4. MASSSTAB-TABELLE (die funktionierenden Variablen)
// =====================================================================
function renderMassstab() {
    const body = document.getElementById('massstab-body');
    body.innerHTML = variablenDaten.massstab.map(m => `
        <tr>
            <td><code>${m.variable}</code></td>
            <td><code>${m.inhalt}</code></td>
            <td>${m.bedeutung}</td>
            <td>${m.referenzen}</td>
        </tr>
    `).join('');
}

// =====================================================================
// 5. BAUSTEIN-TABELLE (Uebersetzung L1/2 -> Laser 3)
// =====================================================================
function renderBausteine() {
    const body = document.getElementById('bausteine-body');
    body.innerHTML = variablenDaten.bausteine.map(b => `
        <tr>
            <td><code>${b.l12}</code></td>
            <td>${b.rolle}</td>
            <td><code>${b.l3}</code></td>
        </tr>
    `).join('');
}

// =====================================================================
// 6. GRUPPEN-TABELLE (die 6 PRUEFEN-Sonderfaelle)
// =====================================================================
function renderGruppen() {
    const body = document.getElementById('gruppen-body');
    const info = variablenDaten.gruppen_info;
    const anzahl = {};
    for (const x of variablenDaten.produkte) {
        if (x.gruppe) anzahl[x.gruppe] = (anzahl[x.gruppe] || 0) + 1;
    }
    const titel = Object.keys(info).sort();
    body.innerHTML = titel.map(g => `
        <tr>
            <td><strong>${info[g].titel}</strong><br>
                <small>${anzahl[g] || 0} Produkte</small></td>
            <td>${info[g].beschreibung}</td>
            <td>${info[g].empfehlung}</td>
        </tr>
    `).join('');
}

// =====================================================================
// 7. PRODUKT-TABELLE MIT SUCHE UND FILTER
// =====================================================================
function renderTabelle(liste) {
    const body = document.getElementById('variablen-body');
    if (liste.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="loading-row">Keine Treffer</td></tr>';
        return;
    }
    body.innerHTML = liste.map(x => {
        // PRUEFEN-Produkte rot markieren (gleiches Farbsystem wie Warnungen)
        const klasse = x.gruppe ? 'row-warnung' : '';
        const hinweis = x.gruppe
            ? `PR&Uuml;FEN Gruppe ${x.gruppe}`
            : (x.referenz ? 'Referenz: ' + x.referenz : '');
        return `
        <tr class="${klasse}">
            <td><strong>${x.produkt}</strong></td>
            <td><code>${x.ase}</code></td>
            <td>${x.quelle}</td>
            <td><code>${x.l12_variable}</code></td>
            <td><small>${x.l12_inhalt}</small></td>
            <td><strong>${x.empfehlung}</strong><br><small>${hinweis}</small></td>
        </tr>`;
    }).join('');
}

// Filter: Suchfeld + Gruppen-Auswahl kombinieren
function filterVariablen() {
    const suchtext = document.getElementById('suche-var').value.toLowerCase().trim();
    const filter = document.getElementById('gruppe-filter').value;
    const liste = variablenDaten.produkte.filter(x => {
        // Suchfilter: Produktname oder ASE-Nummer
        if (suchtext &&
            !x.produkt.toLowerCase().includes(suchtext) &&
            !x.ase.toLowerCase().includes(suchtext)) {
            return false;
        }
        // Gruppenfilter
        if (filter === 'rawcode-single' && x.empfehlung !== 'rawcode-single') return false;
        if (filter === 'rawcode-single-WWYY' &&
            !(x.empfehlung === 'rawcode-single-WWYY' ||
              x.empfehlung.startsWith('rawcode-single-WWYY'))) return false;
        if (filter && filter.length === 1 && x.gruppe !== filter) return false;
        return true;
    });
    renderTabelle(liste);
}
