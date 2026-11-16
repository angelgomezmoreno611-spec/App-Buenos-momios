import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:buenos_momios/updater.dart';

Map<String, dynamic> release(
  String tag,
  List<String> assets, {
  bool draft = false,
}) => {
  'tag_name': tag,
  'draft': draft,
  'body': 'Notas $tag',
  'assets': [
    for (final a in assets) {'browser_download_url': a},
  ],
};

Updater updater(List<Map<String, dynamic>> releases, {int status = 200}) =>
    Updater(
      client: MockClient((request) async {
        expect(request.url.host, 'api.github.com');
        expect(request.url.path, '/repos/${Updater.repo}/releases');
        return http.Response(jsonEncode(releases), status);
      }),
    );

void main() {
  test(
    'elige el release app-vN más alto con APK de GitHub por HTTPS',
    () async {
      final latest = await updater([
        release('app-v3', [
          'https://github.com/x/y/releases/download/app-v3/app.apk',
        ]),
        release('app-v9', ['https://evil.example/app.apk']),
        release('app-v8', [
          'https://github.com/x/y/releases/download/app-v8/app.apk',
        ], draft: true),
        release('v2.0', [
          'https://github.com/x/y/releases/download/v2.0/app.apk',
        ]),
        release('app-v5', [
          'https://github.com/x/y/releases/download/app-v5/notas.txt',
          'https://github.com/x/y/releases/download/app-v5/app.apk',
        ]),
      ]).latest();
      expect(latest!.build, 5);
      expect(latest.apkUrl.path, endsWith('/app-v5/app.apk'));
      expect(latest.notes, 'Notas app-v5');
    },
  );

  test(
    'sin releases válidos no ofrece nada; errores de GitHub se notifican',
    () async {
      expect(await updater([]).available(), isNull);
      expect(await updater([release('app-v4', [])]).latest(), isNull);
      await expectLater(updater([], status: 403).latest(), throwsException);
    },
  );

  test('solo ofrece versiones más nuevas que la instalada', () async {
    // En pruebas APP_BUILD no está definido (0): cualquier release es más nuevo.
    expect(Updater.build, 0);
    final found = await updater([
      release('app-v1', [
        'https://github.com/x/y/releases/download/app-v1/app.apk',
      ]),
    ]).available();
    expect(found?.build, 1);
  });
}
