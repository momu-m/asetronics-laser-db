// =====================================================================
// ALPA - Konfiguration fuer Supabase
// =====================================================================
// Zweck:  Zentrale Stelle fuer die Supabase-Zugangsdaten.
//         Alle Seiten importieren diese Datei.
//
// WICHTIG: Die beiden Werte SUPABASE_URL und SUPABASE_ANON_KEY musst
//          du eintragen, nachdem du das Supabase-Projekt erstellt hast.
//          Siehe Anleitung in docs/ANLEITUNG_SETUP.md
//
// Diese Werte sind NICHT geheim. Sie gehoeren in den Code (anonyme
// Zugriffsebene). Die Sicherheit kommt durch Row Level Security (RLS).
// =====================================================================

const SUPABASE_CONFIG = {
    // -----------------------------------------------------------------
    // Deine Supabase-Projekt-URL
    // Format: https://XXXXXXXXXXXX.supabase.co
    // -----------------------------------------------------------------
    url: 'https://dpxcrhywvblsbilyeiaw.supabase.co',

    // -----------------------------------------------------------------
    // Anonymer Schluessel (anon key) - public, darf im Frontend stehen.
    // Im Supabase Dashboard: Settings -> API -> "anon public"
    // SICHERHEITSHINWEIS: Niemals den "service_role" Key hier eintragen!
    //                     Der service_role Key umgeht alle Sicherheitsregeln.
    // -----------------------------------------------------------------
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRweGNyaHl3dmJsc2JpbHllaWF3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzNTk4MDcsImV4cCI6MjEwMTkzNTgwN30.kO71lw4gvIASd6yTdn4p3Wu-4H8WbxjX9ESiEM_Ncf4'
};

// =====================================================================
// Ab hier nichts aendern - Initialisierung der Supabase-Bibliothek
// =====================================================================

// Supabase-Client erstellen (Verbindung zur Datenbank)
// Wenn die Bibliothek geladen ist (ueber CDN in den HTML-Dateien),
// stellt uns window.supabase die Verfuegbarkeit zur Verfuegung.
let supabaseClient = null;

/**
 * Initialisiert den Supabase-Client.
 * Wird beim Laden jeder Seite aufgerufen.
 * @returns {Object|null} Supabase-Client oder null bei Fehler
 */
function initSupabase() {
    // Pruefen, ob die Werte eingetragen wurden
    if (SUPABASE_CONFIG.url === 'HIER_SUPABASE_URL_EINTRAGEN' ||
        SUPABASE_CONFIG.anonKey === 'HIER_ANON_KEY_EINTRAGEN') {
        console.error('FEHLER: Supabase-Konfiguration fehlt.');
        console.error('Trage URL und anonKey in frontend/config.js ein.');
        console.error('Anleitung: docs/ANLEITUNG_SETUP.md');
        return null;
    }

    // Supabase-Bibliothek muss geladen sein (ueber CDN)
    if (typeof window.supabase === 'undefined') {
        console.error('FEHLER: Supabase-Bibliothek nicht geladen.');
        return null;
    }

    // Client erstellen
    supabaseClient = window.supabase.createClient(
        SUPABASE_CONFIG.url,
        SUPABASE_CONFIG.anonKey
    );

    return supabaseClient;
}

// Global verfuegbar machen
window.SUPABASE_CONFIG = SUPABASE_CONFIG;
window.initSupabase = initSupabase;
