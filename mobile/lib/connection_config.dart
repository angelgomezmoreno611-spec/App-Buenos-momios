String? connectionError({
  required String supabaseUrl,
  required String publishableKey,
  required String apiUrl,
  required bool debugMode,
  bool allowLocalApi = false,
}) {
  final supabase = Uri.tryParse(supabaseUrl);
  if (supabase == null ||
      supabase.scheme != 'https' ||
      supabase.host.isEmpty ||
      supabase.userInfo.isNotEmpty) {
    return 'Configura SUPABASE_URL con la URL HTTPS de tu proyecto.';
  }
  if (publishableKey.isEmpty) {
    return 'Configura SUPABASE_PUBLISHABLE_KEY con la clave pública del proyecto.';
  }
  if (publishableKey.startsWith('sb_secret_')) {
    return 'Usa la clave pública Publishable en la app. La clave Secret pertenece al servidor.';
  }
  final api = Uri.tryParse(apiUrl);
  if (api == null ||
      api.host.isEmpty ||
      api.userInfo.isNotEmpty ||
      api.hasQuery ||
      api.hasFragment) {
    return 'Configura API_URL con la dirección de tu backend.';
  }
  final local =
      debugMode &&
      allowLocalApi &&
      api.scheme == 'http' &&
      ['localhost', '127.0.0.1', '::1', '10.0.2.2'].contains(api.host);
  if (api.scheme != 'https' && !local) {
    return 'API_URL requiere HTTPS. HTTP local solo se permite en desarrollo con ALLOW_LOCAL_API=true.';
  }
  return null;
}
