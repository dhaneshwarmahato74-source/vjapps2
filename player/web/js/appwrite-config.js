/* Appwrite connection. Leave `project` empty = LOCAL MODE (works instantly, links stay in this browser only).
   Fill the values to share links between admin page and preview page on every device. */
window.DLS_BACKEND = {
  endpoint: 'https://sgp.cloud.appwrite.io/v1',
  project: '6af19ff6002d1c4eb2b6',        // Appwrite Project ID
  databaseId: '6af1a25500105a08dfdb',     // Database ID (Production TablesDB)
  collectionId: '6af1a25f0037eb45443c',   // Table ID (new Appwrite) or Collection ID (old Appwrite); columns: name, url, kind
  adminEmail: 'admin@diamond-led.com'     // the Appwrite user you create (password = admin password)
};
