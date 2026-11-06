import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'api.dart';
import 'auth.dart';
import 'connection_config.dart';
import 'dashboard.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  String? error;
  if (!Api.demo) {
    final url = const String.fromEnvironment('SUPABASE_URL').trim();
    final key = const String.fromEnvironment(
      'SUPABASE_PUBLISHABLE_KEY',
      defaultValue: String.fromEnvironment('SUPABASE_ANON_KEY'),
    ).trim();
    try {
      final configurationError = connectionError(
        supabaseUrl: url,
        publishableKey: key,
        apiUrl: Api.baseUrl,
        debugMode: kDebugMode,
        allowLocalApi: const bool.fromEnvironment('ALLOW_LOCAL_API'),
      );
      if (configurationError != null) throw StateError(configurationError);
      // Única inicialización: todas las pantallas comparten Supabase.instance.client.
      await Supabase.initialize(url: url, publishableKey: key);
    } on StateError catch (configurationError) {
      error = configurationError.message;
    } catch (_) {
      error =
          'No se pudo iniciar el modo real. Revisa la configuración de Supabase y la URL HTTPS de la API.';
    }
  }
  runApp(BuenosMomiosApp(startupError: error));
}

class BuenosMomiosApp extends StatelessWidget {
  final String? startupError;
  const BuenosMomiosApp({super.key, this.startupError});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'Buenos Momios',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      scaffoldBackgroundColor: const Color(0xFF0C1117),
      colorScheme: const ColorScheme.dark(
        primary: Color(0xFFC4F566),
        secondary: Color(0xFF72CBBB),
        surface: Color(0xFF151D27),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        filled: true,
      ),
      cardTheme: const CardThemeData(color: Color(0xFF151D27), elevation: 0),
      navigationBarTheme: const NavigationBarThemeData(
        backgroundColor: Color(0xFF111821),
        indicatorColor: Color(0xFF314023),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(0, 48),
          textStyle: const TextStyle(fontWeight: FontWeight.w800),
        ),
      ),
    ),
    home: startupError != null
        ? Scaffold(
            body: Center(
              child: Padding(
                padding: const EdgeInsets.all(28),
                child: Text(startupError!),
              ),
            ),
          )
        : Api.demo
        ? const Dashboard()
        : StreamBuilder<AuthState>(
            stream: Supabase.instance.client.auth.onAuthStateChange,
            builder: (context, snapshot) {
              final session =
                  snapshot.data?.session ??
                  Supabase.instance.client.auth.currentSession;
              return session == null
                  ? const LoginScreen()
                  : Dashboard(key: ValueKey(session.user.id));
            },
          ),
  );
}
