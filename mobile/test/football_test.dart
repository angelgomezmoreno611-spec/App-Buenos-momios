import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:buenos_momios/api.dart';
import 'package:buenos_momios/main.dart';
import 'package:buenos_momios/models.dart';
import 'package:buenos_momios/football_screen.dart';

class RecoveringApi extends Api {
  int calls = 0;
  @override
  Future<Json> footballSources() async => {
    'defaultSeason': 2026,
    'sources': [
      {
        'id': 'example',
        'name': 'Fuente de ejemplo',
        'enabled': true,
        'competitions': [
          {'id': 'league', 'name': 'Liga'},
        ],
        'note': 'Datos de prueba.',
      },
    ],
  };
  @override
  Future<Json> footballMatches({
    required String provider,
    String? competition,
    int? season,
    String? date,
  }) async {
    calls++;
    if (calls == 1) throw Exception('Fuente temporalmente no disponible.');
    return {'source': 'Fuente de ejemplo', 'matches': [], 'warnings': []};
  }
}

void main() {
  setUp(() {
    rootBundle.clear();
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets(
    'Partidos abre una ficha demo y distingue estadísticas inventadas',
    (tester) async {
      tester.view.physicalSize = const Size(390, 844);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final api = Api();
      addTearDown(api.close);
      final data = await api.footballMatches(provider: 'demo');
      final first = (data['matches'] as List).first as Json;
      final title = '${first['home']} vs ${first['away']}';
      await tester.pumpWidget(const BuenosMomiosApp());
      await tester.pumpAndSettle();
      await tester.tap(find.text('Partidos'));
      await tester.pumpAndSettle();
      expect(
        find.text('MODO DEMOSTRACIÓN · Partidos y estadísticas inventados'),
        findsOneWidget,
      );
      await tester.scrollUntilVisible(find.text(title), 200);
      await tester.tap(find.text(title));
      await tester.pumpAndSettle();
      expect(find.text('Ficha del partido'), findsOneWidget);
      expect(find.text('Estadio: Estadio de ejemplo'), findsOneWidget);
      await tester.scrollUntilVisible(find.text('Remates (ejemplo)'), 150);
      expect(find.text('Remates (ejemplo)'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.byType(FootballScreen), findsOneWidget);
      expect(find.text(title), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'fallo de una fuente permite reintentar sin presentar un vacío falso',
    (tester) async {
      final api = RecoveringApi();
      addTearDown(api.close);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: FootballScreen(api: api)),
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Reintentar'), 150);
      expect(find.text('Fuente temporalmente no disponible.'), findsOneWidget);
      expect(
        find.textContaining('Esta fuente no devolvió partidos'),
        findsNothing,
      );
      await tester.tap(find.text('Reintentar'));
      await tester.pumpAndSettle();
      expect(api.calls, 2);
      expect(find.text('Fuente temporalmente no disponible.'), findsNothing);
      expect(
        find.textContaining('Esta fuente no devolvió partidos'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
    },
  );
}
