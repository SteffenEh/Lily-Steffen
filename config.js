// Öffentliche Supabase-Werte. Beide dürfen im Code stehen:
// Die Daten schützen die Zugriffsregeln (Row Level Security) in der Datenbank.
// Den Secret Key NIEMALS hier eintragen.
window.APP_CONFIG = {
  SUPABASE_URL: 'https://dlzqfjsudqjsdbovhkgs.supabase.co',
  SUPABASE_KEY: 'sb_publishable_bXSrL-7BzxdlA4H0vPjqCw_8im5n54f',
  // Öffentlicher Push-Schlüssel (der geheime liegt nur in Supabase)
  VAPID_PUBLIC_KEY: 'BDbc7Zq7PLpyR5rqCFu950CGYhlhn0iT4lzZpi3ytJWxwfVIoc6sH4r6kJNWdWDA09rWcBGWddrUTxjm1717f-w'
};
