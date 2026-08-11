// =====================================================================
// ALPA - Rechner & Planer (rechner.js)
// =====================================================================
// Zweck:  Drei Werkzeuge fuer die Laser-3-Programmierung:
//         1. DMC-Uebersetzer  - DMC-Struktur -> Laser-3-Variable + Label
//         2. LP-Planer        - 1 Leiterplatte mit mehreren DMC-Positionen
//         3. Nutzen-Planer    - Panel mit mehreren Leiterplatten
//
// WICHTIG: Diese Datei ist separat von app.js, weil app.js schon
//          ueber 1700 Zeilen hat. Fuer die Wartbarkeit (Mo als Anfaenger)
//          ist ein eigenes Modus-Modul besser.
//
// Abhaengigkeiten: app.js muss VOR rechner.js geladen werden, weil
//                  wir initSupabase(), checkAuth(), displayUserInfo()
//                  und ladeAdminHeader() von dort nutzen.
// =====================================================================


// =====================================================================
// 0. INITIALISIERUNG (beim Laden der Seite)
// =====================================================================

document.addEventListener('DOMContentLoaded', async () => {
    // Tab-Navigation aktivieren
    initialisiereTabs();

    // Session pruefen (Login erforderlich)
    const session = await checkAuth();
    if (!session) return;

    // User-Info und Admin-Badge im Header anzeigen
    displayUserInfo(session);
    await ladeAdminHeader(session);

    // Alle drei Werkzeuge einmal berechnen/zeichnen
    dmcBerechnen();
    zeichneLpPlan();
    zeichneNutzenPlan();
});


// =====================================================================
// 1. TAB-NAVIGATION
// =====================================================================

function initialisiereTabs() {
    const tabs = document.querySelectorAll('.rechner-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Alle Tabs inaktiv
            tabs.forEach(t => t.classList.remove('active'));
            // Alle Sections verbergen
            document.querySelectorAll('.rechner-section').forEach(s => {
                s.classList.remove('active');
            });
            // Gewaehlten Tab aktivieren
            tab.classList.add('active');
            const targetId = 'tab-' + tab.getAttribute('data-tab');
            const section = document.getElementById(targetId);
            if (section) section.classList.add('active');

            // Canvas bei Tab-Wechsel neu zeichnen (sonst leer bei
            // display:none umschaltung)
            if (tab.getAttribute('data-tab') === 'lp') {
                setTimeout(zeichneLpPlan, 50);
            } else if (tab.getAttribute('data-tab') === 'nutzen') {
                setTimeout(zeichneNutzenPlan, 50);
            }
        });
    });
}


// =====================================================================
// 2. DMC-UEBERSETZER (Mohamads Hauptwunsch)
// =====================================================================
// Kernlogik: Uebersetzt eine DMC-Struktur wie
//   <part-nr(8)><serial(8)><rev(2)><binning(1)>
// in eine konkrete Laser-3-Empfehlung:
//   - Composite-Variable (rawcode-single, -WWYY, -set)
//   - CLEARTEXT-Formel (wie in der .VARIABLE-Datei)
//   - Beispiel-DMC
//   - Label-Empfehlung passend zur Zeichenlaenge
//   - Schritt-fuer-Schritt Anleitung fuer Laser 3


// ----- Uebersetzungstabelle (direkt aus Laser-3-Dateien abgeleitet) -----
// Jeder Baustein in Mohamads DMC wird auf eine Laser-3-Variable gemappt.
// Diese Tabelle ist die "Bibel" fuer die Uebersetzung.
const DMC_BAUSTEINE = {
    'part-nr': {
        laser3: 'fmtKundenText',          // In rawcode-single COMPOSITE
        laser3Set: 'customerPartNumber',  // In rawcode-set COMPOSITE
        label: 'Kunden-Artikelnr',
        description: 'Die Asetronics-Materialnummer (z.B. A45A0910)'
    },
    'serial': {
        laser3: 'serial_CONVERTER',
        label: 'Seriennummer',
        description: 'Fortlaufende Nummer, generiert vom Converter'
    },
    'rev': {
        laser3: 'customerPartIndex_FIELD_TASK',
        label: 'Revision (Index)',
        description: 'Revisionslevel des Produkts (01, 02, ...)'
    },
    'binning': {
        laser3: 'binning_FIELD_TASK',
        label: 'Binning',
        description: 'Sortierklasse nach Pruefung (1, 2, 3)'
    },
    'datum': {
        laser3: 'rawcode-single-YYWW_DATE',
        label: 'Datum (YYWW)',
        description: 'Jahr + Woche (z.B. 2631 = Jahr 2026, Woche 31)'
    },
    // NEU (Session 7): plant-location fuer BM080-01HA / BM080-05HA
    // Diese Produkte haben am Ende eine 1-stellige Werks-Kennung.
    'plant-location': {
        laser3: 'plantLocation_FIELD_TASK',
        label: 'Werksstandort (Plant Location)',
        description: '1-stelliger Code fuer den Hella-Werksstandort (z.B. 5)'
    }
};

// Die Composite-Variablen auf Laser 3 (aus Variables-Ordner):
// Session 7: plant-location-Variante fuer BM080-01HA / BM080-05HA ergaenzt.
const COMPOSITE_VARIANTS = {
    'rawcode-single': {
        name: 'rawcode-single',
        cleartext: '[fmtKundenText][serial][customerPartIndex][binning]',
        match: ['part-nr', 'serial', 'rev', 'binning'],
        beschreibung: 'Standard-DMC fuer Einzellayouts'
    },
    'rawcode-single-WWYY': {
        name: 'rawcode-single-WWYY',
        cleartext: '[fmtKundenText][serial][customerPartIndex][binning][rawcode-single-YYWW_DATE]',
        match: ['part-nr', 'serial', 'rev', 'binning', 'datum'],
        beschreibung: 'Standard-DMC mit Datum (Jahr+Woche)'
    },
    'rawcode-set': {
        name: 'rawcode-set',
        cleartext: '[customerPartNumber][serial][customerPartIndex][binning]',
        match: ['part-nr', 'serial', 'rev', 'binning'],
        beschreibung: 'Fuer SET-Produkte (mehrere LPs in einem Nutzen)'
    },
    // NEU (Session 7): Variante mit Werksstandort am Schluss.
    'rawcode-single-PLANT': {
        name: 'rawcode-single-PLANT',
        cleartext: '[fmtKundenText][serial][customerPartIndex][binning][plantLocation]',
        match: ['part-nr', 'serial', 'rev', 'binning', 'plant-location'],
        beschreibung: 'DMC mit Werksstandort (Plant Location) am Ende, z.B. BM080-Serie'
    }
};

// Label-Empfehlung nach Zeichenlaenge
// (basierend auf /Users/momu/Downloads/laser3-veriabl/Labels/)
function labelFuerLaenge(laenge) {
    if (laenge <= 15) {
        return {
            name: 'DMC-35mm-16x16-15alphanum',
            groesse: '3.5 x 3.5 mm',
            bemerkung: 'Spezial-Kleinlayout (z.B. VW055-00)'
        };
    }
    if (laenge <= 19) {
        return {
            name: 'DMC-35mm-16x16-19alphanum',
            groesse: '3.5 x 3.5 mm',
            bemerkung: 'Kleinlayout fuer 16-19 Zeichen'
        };
    }
    if (laenge <= 22) {
        return {
            name: 'DMC-35mm-16x16-22alphanum',
            groesse: '3.5 x 3.5 mm',
            bemerkung: 'Mittel-Layout fuer 20-22 Zeichen'
        };
    }
    if (laenge <= 24) {
        return {
            name: 'DMC-55mm-18x18-24alphanum',
            groesse: '5.5 x 5.5 mm',
            bemerkung: 'Gross-Layout fuer 23-24 Zeichen'
        };
    }
    return {
        name: '[kein passendes Label vorhanden]',
        groesse: '?',
        bemerkung: 'Laenge > 24 Zeichen - mit Laser-3-Hersteller klaeren'
    };
}


// ----- Modus-Umschaltung (Baukasten vs. Freitext) -----

function dmcModusWechseln() {
    const modus = document.querySelector('input[name="dmc-modus"]:checked').value;
    const baukasten = document.getElementById('dmc-baukasten');
    const freitext = document.getElementById('dmc-freitext');

    if (modus === 'baukasten') {
        baukasten.style.display = 'block';
        freitext.style.display = 'none';
    } else {
        baukasten.style.display = 'none';
        freitext.style.display = 'block';
    }
    dmcBerechnen();
}


// ----- Hauptfunktion: DMC analysieren und Empfehlung ausgeben -----

function dmcBerechnen() {
    // 1. Bausteine sammeln (je nach Modus)
    let bausteine = [];

    const modus = document.querySelector('input[name="dmc-modus"]:checked')?.value || 'baukasten';

    if (modus === 'baukasten') {
        // Baukasten: aus den Checkboxen + Laengen lesen
        if (document.getElementById('b-part').checked) {
            bausteine.push({
                name: 'part-nr',
                laenge: parseInt(document.getElementById('b-part-len').value) || 0,
                bsp: document.getElementById('b-part-bsp').value || ''
            });
        }
        if (document.getElementById('b-serial').checked) {
            bausteine.push({
                name: 'serial',
                laenge: parseInt(document.getElementById('b-serial-len').value) || 0,
                bsp: document.getElementById('b-serial-bsp').value || ''
            });
        }
        if (document.getElementById('b-rev').checked) {
            bausteine.push({
                name: 'rev',
                laenge: parseInt(document.getElementById('b-rev-len').value) || 0,
                bsp: document.getElementById('b-rev-bsp').value || ''
            });
        }
        if (document.getElementById('b-bin').checked) {
            bausteine.push({
                name: 'binning',
                laenge: parseInt(document.getElementById('b-bin-len').value) || 0,
                bsp: document.getElementById('b-bin-bsp').value || ''
            });
        }
        if (document.getElementById('b-date').checked) {
            bausteine.push({
                name: 'datum',
                laenge: 4,
                bsp: document.getElementById('b-date-bsp').value || ''
            });
        }
        // NEU (Session 7): plant-location aus dem Baukasten lesen
        if (document.getElementById('b-plant')?.checked) {
            bausteine.push({
                name: 'plant-location',
                laenge: parseInt(document.getElementById('b-plant-len').value) || 1,
                bsp: document.getElementById('b-plant-bsp').value || ''
            });
        }
    } else {
        // Freitext: Text parsen
        const text = document.getElementById('dmc-freitext-input').value;
        bausteine = parseDmcFreitext(text);
    }

    // 2. Empfehlung zusammenstellen
    const ergebnis = analysiereBausteine(bausteine);

    // 3. Ergebnis anzeigen
    const container = document.getElementById('dmc-ergebnis');
    if (!container) return;

    if (bausteine.length === 0) {
        container.innerHTML =
            '<div class="empty-state">Bitte mindestens einen Baustein wählen.</div>';
        return;
    }

    container.innerHTML = renderDmcErgebnis(bausteine, ergebnis);
}


// ----- Parser fuer Freitext-Eingabe -----
// Erkennt Patterns wie:
//   <part-nr(8)><serial(8)><rev(2)><binning(1)>
//   <part-nr><serial><rev><binning>
//   part-nr, serial, rev, binning
function parseDmcFreitext(text) {
    const bausteine = [];
    if (!text) return bausteine;

    // Pattern: <name(len)> oder <name> oder name(len) oder name
    // Wir suchen alle Vorkommen von Namen in <>, optional mit (Zahl)
    const pattern = /<?\s*([a-zA-Z-]+)\s*(?:\((\d+)\))?\s*>?/g;
    let match;

    // Gueltige Baustein-Namen (case-insensitiv)
    // Session 7: plant-location ergaenzt.
    const validNames = {
        'part-nr': 'part-nr', 'partnr': 'part-nr', 'part': 'part-nr',
        'kundenartikel': 'part-nr', 'artikel': 'part-nr',
        'serial': 'serial', 'seriennummer': 'serial', 'sernr': 'serial',
        'rev': 'rev', 'revision': 'rev', 'customerpartindex': 'rev', 'index': 'rev',
        'binning': 'binning', 'bin': 'binning', 'klasse': 'binning',
        'datum': 'datum', 'date': 'datum', 'yyww': 'datum', 'datum-yyww': 'datum',
        // NEU (Session 7): Werksstandort
        'plant-location': 'plant-location', 'plantlocation': 'plant-location',
        'plant': 'plant-location', 'werksstandort': 'plant-location',
        'werk': 'plant-location', 'location': 'plant-location'
    };

    while ((match = pattern.exec(text)) !== null) {
        const rawName = match[1].toLowerCase().trim();
        const laenge = match[2] ? parseInt(match[2]) : 0;
        const mapping = validNames[rawName];

        if (mapping) {
            // Standardlaenge wenn nicht angegeben
            // Session 7: plant-location mit Standardlaenge 1 ergaenzt.
            const standardLaenge = {
                'part-nr': 8, 'serial': 8, 'rev': 2, 'binning': 1, 'datum': 4,
                'plant-location': 1
            }[mapping];
            bausteine.push({
                name: mapping,
                laenge: laenge || standardLaenge,
                bsp: ''
            });
        }
    }

    return bausteine;
}


// ----- Kernlogik: Bausteine analysieren -> Variablen-Typ + CLEARTEXT -----
// Session 7: Logik robuster gemacht fuer alle 7 Muster aus dem
// Laser-3-Qualification-Plan. Frueher wurde nur "datum" abgefragt und
// starr rawcode-single-WWYY gewaehlt. Jetzt pruefen wir gegen alle
// definierten COMPOSITE_VARIANTS und nehmen die beste Uebereinstimmung.

function analysiereBausteine(bausteine) {
    const namen = bausteine.map(b => b.name);
    const gesamtLaenge = bausteine.reduce((sum, b) => sum + b.laenge, 0);

    // Composite-Variable bestimmen: Wir zaehlen, wie viele Bausteine
    // der Anwender gewaehlt hat, die in der "match"-Liste jeder Variante
    // stehen. Die Variante mit der hoechsten Uebereinstimmung gewinnt.
    // Zusaetzlich muss die Anzahl Bausteine ungefaehr stimmen, sonst
    // wuerde z.B. rawcode-single (4 Bausteine) auch bei 5 gewaehlten
    // passen, obwohl rawcode-single-WWYY die richtige waere.
    let besterScore = -1;
    let composite = COMPOSITE_VARIANTS['rawcode-single']; // Fallback

    Object.values(COMPOSITE_VARIANTS).forEach(variante => {
        // Wie viele der gewaehlten Bausteine sind in der match-Liste?
        const treffer = namen.filter(n => variante.match.includes(n)).length;
        // Score: Treffer minus Abweichung in der Gesamtzahl.
        // So gewinnt die Variante, die am besten zur Auswahl passt.
        const abweichung = Math.abs(namen.length - variante.match.length);
        const score = treffer * 2 - abweichung;
        if (score > besterScore) {
            besterScore = score;
            composite = variante;
        }
    });

    // Beispiel-DMC zusammenbauen (aus den Bsp-Werten)
    const bspDmc = bausteine.map(b =>
        (b.bsp || '?'.repeat(b.laenge)).slice(0, b.laenge).padEnd(b.laenge, '0')
    ).join('');

    // Label bestimmen
    const label = labelFuerLaenge(gesamtLaenge);

    // Schritt-fuer-Schritt Anleitung generieren
    const schritte = generiereKonfigurationsSchritte(bausteine, composite);

    // Warnung, wenn die gewaehlten Bausteine nicht exakt zur Composite passen.
    // Session 7: Pruefung in BEIDE Richtungen.
    //   1. Gewaehlt aber nicht in Composite -> Baustein wird ignoriert
    //   2. In Composite aber nicht gewaehlt  -> Composite erwartet etwas das fehlt
    //      (z.B. VW055-00 hat kein part-nr, aber rawcode-single-WWYY erwartet fmtKundenText)
    let warnung = null;
    const fehlendeInComposite = namen.filter(n => !composite.match.includes(n));
    const fehlendeInAuswahl = composite.match.filter(n => !namen.includes(n));

    if (fehlendeInComposite.length > 0 || fehlendeInAuswahl.length > 0) {
        const teile = [];
        if (fehlendeInComposite.length > 0) {
            teile.push('Gewaehlt aber nicht in Composite: ' + fehlendeInComposite.join(', '));
        }
        if (fehlendeInAuswahl.length > 0) {
            teile.push('Composite erwartet aber nicht gewaehlt: ' + fehlendeInAuswahl.join(', '));
        }
        warnung = 'Achtung: Die Auswahl passt nicht exakt zur empfohlenen Composite-Variante. ' +
            teile.join(' | ') +
            ' Bitte Struktur manuell pruefen oder eine eigene Composite anlegen.';
    }

    return {
        composite,
        gesamtLaenge,
        bspDmc,
        label,
        schritte,
        namen,
        warnung
    };
}


// ----- Generiert Schritt-fuer-Schritt Anleitung fuer Laser 3 -----
// Session 7: Schritte werden jetzt dynamisch aus den gewaehlten Bausteinen
// abgeleitet. So erscheint z.B. der Datum-Schritt nur, wenn "datum"
// ausgewaehlt wurde, und der plant-location-Schritt nur bei Bedarf.

function generiereKonfigurationsSchritte(bausteine, composite) {
    const schritte = [];
    const namen = bausteine.map(b => b.name);

    // Schritt 1: immer - Composite-Variable anlegen
    schritte.push({
        nr: 1,
        titel: 'Composite-Variable anlegen',
        detail: 'In Simplex eine neue COMPOSITE-Variable mit dem Namen "' +
                composite.name + '" anlegen. CLEARTEXT-Formel exakt wie oben angegeben uebernehmen.'
    });

    let nr = 2;

    // Schritt fuer part-nr (nur wenn ausgewaehlt - wichtig fuer VW055-00
    // das KEINE part-nr hat)
    if (namen.includes('part-nr')) {
        schritte.push({
            nr: nr++,
            titel: 'fmtKundenText-Feld (part-nr)',
            detail: 'FIELD-Typ, CONNECTION=3. Wert kommt vom Job (Kunden-Artikelnummer wie A45A0910).'
        });
    }

    // Schritt fuer serial
    if (namen.includes('serial')) {
        schritte.push({
            nr: nr++,
            titel: 'serial_CONVERTER (serial)',
            detail: 'CONVERTER-Typ, LENGTH=99, STARTPOSITION=1. Liest die laufende Seriennummer aus dem Job.'
        });
    }

    // Schritt fuer rev
    if (namen.includes('rev')) {
        schritte.push({
            nr: nr++,
            titel: 'customerPartIndex-Feld (rev)',
            detail: 'FIELD-Typ, CONNECTION=3. Wert = Revisionslevel (z.B. "01").'
        });
    }

    // Schritt fuer binning
    if (namen.includes('binning')) {
        schritte.push({
            nr: nr++,
            titel: 'binning-Feld (binning)',
            detail: 'FIELD-Typ, CONNECTION=3. Wert = Sortierklasse (1 bis 9 bzw. mehrstellig).'
        });
    }

    // Schritt fuer datum (nur bei WWYY-Variante)
    if (namen.includes('datum')) {
        schritte.push({
            nr: nr++,
            titel: 'rawcode-single-YYWW_DATE (datum)',
            detail: 'DATE-Typ, FORMAT="%W%y" (Woche+Jahr). Aktuell z.B. "3126" = KW 31 / 2026.'
        });
    }

    // Schritt fuer plant-location (NEU Session 7)
    if (namen.includes('plant-location')) {
        schritte.push({
            nr: nr++,
            titel: 'plantLocation-Feld (plant-location)',
            detail: 'FIELD-Typ, CONNECTION=3. Wert = 1-stelliger Werksstandort-Code (z.B. 5). ' +
                    'Speziell fuer BM080-Serie erforderlich.'
        });
    }

    return schritte;
}


// ----- Rendert das Ergebnis-HTML -----

function renderDmcErgebnis(bausteine, erg) {
    const html = [];

    // 0. Warnung anzeigen, falls ein Baustein nicht zur Composite passt
    // (Session 7: neuer Sicherheits-Check)
    if (erg.warnung) {
        html.push(`
            <div class="alert alert-error" style="margin-bottom: 16px;">
                ${escapeHtml(erg.warnung)}
            </div>
        `);
    }

    // 1. Empfohlene Variable (grosses Highlight)
    html.push(`
        <div class="dmc-result-block">
            <div class="dmc-result-label">Empfohlene Laser-3-Variable:</div>
            <div class="dmc-result-value">${escapeHtml(erg.composite.name)}</div>
            <div class="dmc-result-sub">${escapeHtml(erg.composite.beschreibung)}</div>
        </div>
    `);

    // 2. CLEARTEXT-Formel
    html.push(`
        <div class="dmc-result-block">
            <div class="dmc-result-label">CLEARTEXT-Formel (fuer .VARIABLE-Datei):</div>
            <code class="dmc-cleartext">${escapeHtml(erg.composite.cleartext)}</code>
        </div>
    `);

    // 3. Beispiel-DMC + Laenge
    html.push(`
        <div class="dmc-result-block">
            <div class="dmc-result-label">Beispiel-DMC (${erg.gesamtLaenge} Zeichen):</div>
            <code class="dmc-beispiel">${escapeHtml(erg.bspDmc)}</code>
        </div>
    `);

    // 4. Label-Empfehlung
    html.push(`
        <div class="dmc-result-block">
            <div class="dmc-result-label">Empfohlenes Label:</div>
            <div class="dmc-result-value">${escapeHtml(erg.label.name)}</div>
            <div class="dmc-result-sub">
                DMC-Grösse: ${escapeHtml(erg.label.groesse)} ·
                ${escapeHtml(erg.label.bemerkung)}
            </div>
        </div>
    `);

    // 5. Struktur-Zusammenfassung
    html.push(`
        <div class="dmc-result-block">
            <div class="dmc-result-label">DMC-Struktur:</div>
            <div class="dmc-struktur-liste">
                ${bausteine.map(b => `
                    <div class="dmc-struktur-item">
                        <span class="dmc-struktur-name">${escapeHtml(DMC_BAUSTEINE[b.name]?.label || b.name)}</span>
                        <span class="dmc-struktur-laenge">${b.laenge} Zeichen</span>
                        <span class="dmc-struktur-laser3">
                            -&gt; ${escapeHtml(DMC_BAUSTEINE[b.name]?.laser3 || '?')}
                        </span>
                    </div>
                `).join('')}
            </div>
        </div>
    `);

    // 6. Schritt-fuer-Schritt Anleitung
    html.push(`
        <div class="dmc-result-block">
            <div class="dmc-result-label">Schritt-für-Schritt fuer Laser 3:</div>
            <ol class="dmc-schritte">
                ${erg.schritte.map(s => `
                    <li>
                        <strong>${escapeHtml(s.titel)}</strong><br>
                        <span class="dmc-schritt-detail">${escapeHtml(s.detail)}</span>
                    </li>
                `).join('')}
            </ol>
        </div>
    `);

    return html.join('');
}


// =====================================================================
// 3. LP-PLANER (1 Leiterplatte mit mehreren DMC-Positionen)
// =====================================================================

function zeichneLpPlan() {
    const canvas = document.getElementById('lp-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Werte auslesen
    const lpBreite = parseFloat(document.getElementById('lp-breite').value) || 100;
    const lpLaenge = parseFloat(document.getElementById('lp-laenge').value) || 160;
    const startX = parseFloat(document.getElementById('lp-start-x').value) || 5;
    const startY = parseFloat(document.getElementById('lp-start-y').value) || 5;
    const rasterX = parseFloat(document.getElementById('lp-raster-x').value) || 30;
    const rasterY = parseFloat(document.getElementById('lp-raster-y').value) || 40;
    const spalten = parseInt(document.getElementById('lp-spalten').value) || 1;
    const reihen = parseInt(document.getElementById('lp-reihen').value) || 1;

    // Skalierung: LP so gross wie moeglich aufs Canvas zeichnen
    const margin = 50;
    const drawW = W - 2 * margin;
    const drawH = H - 2 * margin;
    const scale = Math.min(drawW / lpBreite, drawH / lpLaenge);

    const lpW = lpBreite * scale;
    const lpH = lpLaenge * scale;
    const lpX = (W - lpW) / 2;
    const lpY = (H - lpH) / 2;

    // LP-Rechteck zeichnen
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(lpX, lpY, lpW, lpH);
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = 2;
    ctx.strokeRect(lpX, lpY, lpW, lpH);

    // Achsenbeschriftung
    ctx.fillStyle = '#6c757d';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('0', lpX - 12, lpY + lpH + 14);
    ctx.fillText(lpBreite + ' mm', lpX + lpW - 30, lpY + lpH + 14);
    ctx.fillText(lpLaenge + ' mm', 5, lpY + 14);

    // DMC-Positionen zeichnen
    // Reihenfolge X-then-Y: Spalte 0..N, dann Reihe hoch
    let posNr = 1;
    let positionen = [];
    for (let r = 0; r < reihen; r++) {
        for (let s = 0; s < spalten; s++) {
            const px = startX + s * rasterX;
            const py = startY + r * rasterY;

            // Nur zeichnen wenn innerhalb der LP
            if (px <= lpBreite + 2 && py <= lpLaenge + 2) {
                positionen.push({ nr: posNr, x: px, y: py });

                // Canvas-Koordinaten (Y invertieren, LP-Ursprung unten links)
                const cx = lpX + px * scale;
                const cy = lpY + lpH - py * scale;

                // DMC als kleines Quadrat (DMCs sind quadratisch)
                const dmcSize = 6;
                ctx.fillStyle = '#0078D4';
                ctx.fillRect(cx - dmcSize / 2, cy - dmcSize / 2, dmcSize, dmcSize);
                ctx.strokeStyle = '#fff';
                ctx.lineWidth = 1;
                ctx.strokeRect(cx - dmcSize / 2, cy - dmcSize / 2, dmcSize, dmcSize);

                // Positionsnummer
                ctx.fillStyle = '#212529';
                ctx.font = '10px IBM Plex Mono, monospace';
                ctx.fillText(posNr, cx + 6, cy + 3);

                posNr++;
            }
        }
    }

    // Titel oben
    ctx.fillStyle = '#212529';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillText(
        `LP ${lpBreite} x ${lpLaenge} mm - ${positionen.length} DMC-Positionen`,
        margin, margin - 16
    );

    // Statistik aktualisieren
    const statContainer = document.getElementById('lp-statistik');
    if (statContainer) {
        statContainer.innerHTML = `
            <strong>${positionen.length}</strong> DMC-Positionen geplant<br>
            <strong>${spalten}</strong> Spalten x <strong>${reihen}</strong> Reihen<br>
            <strong>Raster:</strong> ${rasterX} x ${rasterY} mm
        `;
    }
}


// =====================================================================
// 4. NUTZEN-PLANER (Panel mit mehreren LPs)
// =====================================================================

function zeichneNutzenPlan() {
    const canvas = document.getElementById('nutzen-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Werte auslesen
    const nBreite = parseFloat(document.getElementById('n-breite').value) || 200;
    const nLaenge = parseFloat(document.getElementById('n-laenge').value) || 300;
    const lpBreite = parseFloat(document.getElementById('n-lp-breite').value) || 95;
    const lpLaenge = parseFloat(document.getElementById('n-lp-laenge').value) || 145;
    const rand = parseFloat(document.getElementById('n-rand').value) || 5;
    const orient = document.getElementById('n-orient').value;

    // Berechnen wie viele LPs in den Nutzen passen
    // Spalten = wie viele LPs nebeneinander (X)
    // Reihen = wie viele LPs untereinander (Y)
    const platzProLpX = lpBreite + rand;
    const platzProLpY = lpLaenge + rand;
    const verfuegbarX = nBreite - rand;
    const verfuegbarY = nLaenge - rand;

    // Varianten: LP in Original-Orientierung oder um 90 Grad gedreht
    const varianten = [
        { name: 'Original', lpx: lpBreite, lpy: lpLaenge },
        { name: '90 Grad', lpx: lpLaenge, lpy: lpBreite }
    ];

    let besteConfig = null;
    varianten.forEach(v => {
        const spalten = Math.floor((nBreite - rand) / (v.lpx + rand));
        const reihen = Math.floor((nLaenge - rand) / (v.lpy + rand));
        const total = spalten * reihen;
        if (!besteConfig || total > besteConfig.total) {
            besteConfig = {
                name: v.name, spalten, reihen, total,
                lpx: v.lpx, lpy: v.lpy
            };
        }
    });

    if (!besteConfig || besteConfig.total === 0) {
        // LP passt gar nicht in den Nutzen
        ctx.fillStyle = '#e76f51';
        ctx.font = '14px Inter, sans-serif';
        ctx.fillText('LP passt nicht in den Nutzen!', 50, 50);

        const statContainer = document.getElementById('nutzen-statistik');
        if (statContainer) {
            statContainer.innerHTML = '<span style="color:#e76f51;">LP zu gross für Nutzen.</span>';
        }
        return;
    }

    // Skalierung
    const margin = 50;
    const drawW = W - 2 * margin;
    const drawH = H - 2 * margin;
    const scale = Math.min(drawW / nBreite, drawH / nLaenge);

    const nutW = nBreite * scale;
    const nutH = nLaenge * scale;
    const nutX = (W - nutW) / 2;
    const nutY = (H - nutH) / 2;

    // Nutzen-Rechteck zeichnen
    ctx.fillStyle = '#fff5f5';
    ctx.fillRect(nutX, nutY, nutW, nutH);
    ctx.strokeStyle = '#495057';
    ctx.lineWidth = 2;
    ctx.strokeRect(nutX, nutY, nutW, nutH);

    // LPs zeichnen
    let lpNummer = 1;
    for (let r = 0; r < besteConfig.reihen; r++) {
        for (let s = 0; s < besteConfig.spalten; s++) {
            // LP-Position im Nutzen
            const px = rand + s * (besteConfig.lpx + rand);
            const py = rand + r * (besteConfig.lpy + rand);

            // In Canvas-Koordinaten
            const cx = nutX + px * scale;
            const cy = nutY + nutH - py * scale - besteConfig.lpy * scale;
            const cw = besteConfig.lpx * scale;
            const ch = besteConfig.lpy * scale;

            // LP-Rechteck (abwechselnd eingefärbt bei abwechselnder Orientierung)
            let fill = '#e1e4ea';
            if (orient === 'abwechselnd' && (r + s) % 2 === 1) {
                fill = '#cdd5e0';
            }
            ctx.fillStyle = fill;
            ctx.fillRect(cx, cy, cw, ch);
            ctx.strokeStyle = '#0078D4';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx, cy, cw, ch);

            // LP-Nummer
            ctx.fillStyle = '#212529';
            ctx.font = 'bold 12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('#' + lpNummer, cx + cw / 2, cy + ch / 2);
            ctx.textAlign = 'left';

            lpNummer++;
        }
    }

    // Titel
    ctx.fillStyle = '#212529';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.fillText(
        `Nutzen ${nBreite} x ${nLaenge} mm - ${besteConfig.total} LPs ` +
        `(${besteConfig.spalten}x${besteConfig.reihen}, ${besteConfig.name})`,
        margin, margin - 16
    );

    // Statistik
    const statContainer = document.getElementById('nutzen-statistik');
    if (statContainer) {
        const nutzungsgrad = ((besteConfig.total * lpBreite * lpLaenge) /
                             (nBreite * nLaenge) * 100).toFixed(1);
        statContainer.innerHTML = `
            <strong>${besteConfig.total}</strong> LPs pro Nutzen<br>
            <strong>${besteConfig.spalten}</strong> Spalten x <strong>${besteConfig.reihen}</strong> Reihen<br>
            <strong>Orientierung:</strong> ${besteConfig.name}<br>
            <strong>Nutzungsgrad:</strong> ${nutzungsgrad} % der Nutzen-Fläche
        `;
    }
}
