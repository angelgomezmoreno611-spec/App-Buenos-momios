import 'dart:convert';
import 'package:http/http.dart' as http;

/// Versión publicada de la app (release `app-vN` de GitHub con un APK).
class AppRelease {
  final int build;
  final Uri apkUrl;
  final String notes;
  const AppRelease(this.build, this.apkUrl, this.notes);
}

/// Busca APKs nuevos en los releases de GitHub. `tools/release-apk.sh` compila
/// con `--dart-define=APP_BUILD=N` y publica el release `app-vN`.
class Updater {
  static const build = int.fromEnvironment('APP_BUILD');
  static const repo = 'angelgomezmoreno611-spec/App-Buenos-momios';
  static final _tag = RegExp(r'^app-v(\d+)$');
  final http.Client _client;
  Updater({http.Client? client}) : _client = client ?? http.Client();

  /// El release más nuevo con APK, o null si no hay ninguno.
  Future<AppRelease?> latest() async {
    final response = await _client
        .get(
          Uri.https('api.github.com', '/repos/$repo/releases', {
            'per_page': '20',
          }),
          headers: {'Accept': 'application/vnd.github+json'},
        )
        .timeout(const Duration(seconds: 15));
    if (response.statusCode != 200) {
      throw Exception('GitHub respondió ${response.statusCode}');
    }
    AppRelease? best;
    for (final release in jsonDecode(response.body) as List) {
      final data = release as Map<String, dynamic>;
      if (data['draft'] == true) continue;
      final match = _tag.firstMatch(data['tag_name'] as String? ?? '');
      if (match == null) continue;
      final number = int.parse(match.group(1)!);
      if (best != null && number <= best.build) continue;
      for (final asset in data['assets'] as List? ?? const []) {
        final url = Uri.tryParse(
          (asset as Map<String, dynamic>)['browser_download_url'] as String? ??
              '',
        );
        // Solo descargas HTTPS de GitHub.
        if (url != null &&
            url.scheme == 'https' &&
            url.host == 'github.com' &&
            url.path.endsWith('.apk')) {
          best = AppRelease(number, url, data['body'] as String? ?? '');
          break;
        }
      }
    }
    return best;
  }

  /// Un release más nuevo que la app instalada, o null.
  Future<AppRelease?> available() async {
    final release = await latest();
    return release != null && release.build > build ? release : null;
  }
}
