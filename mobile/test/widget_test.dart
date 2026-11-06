import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:buenos_momios/main.dart';

void main() {
  setUp(() {
    rootBundle.clear();
    SharedPreferences.setMockInitialValues({});
  });
  testWidgets('demo identifica datos sintéticos y abre el análisis', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const BuenosMomiosApp());
    await tester.pumpAndSettle();
    expect(find.text('MODO DEMOSTRACIÓN · Datos inventados'), findsOneWidget);
    expect(find.text('4/4'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Ticket 01'), 200);
    await tester.tap(find.text('Ticket 01'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('de probabilidad conjunta estimada'),
      findsOneWidget,
    );
    expect(find.textContaining('Local: over 2.5'), findsWidgets);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('historial y explicación accesibles en demo', (tester) async {
    await tester.pumpWidget(const BuenosMomiosApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Historial'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Guarda una tanda demo desde Mis tickets'),
      findsOneWidget,
    );
    await tester.tap(find.text('El análisis'));
    await tester.pumpAndSettle();
    expect(find.text('Local y visitante'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
  testWidgets('guardar una tanda demo conserva los cuatro tickets al reabrir', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    await tester.pumpWidget(const BuenosMomiosApp());
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Guardar tanda'), 200);
    await tester.tap(find.text('Guardar tanda'));
    await tester.pumpAndSettle();
    expect(find.text('Tanda guardada'), findsOneWidget);
    expect(
      find.text('Tanda demo guardada en este dispositivo.'),
      findsOneWidget,
    );

    await tester.pumpWidget(const SizedBox());
    await tester.pumpAndSettle();
    await tester.pumpWidget(const BuenosMomiosApp());
    await tester.pumpAndSettle();
    await tester.tap(find.text('Historial'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('Historial local con datos inventados'),
      findsOneWidget,
    );
    await tester.scrollUntilVisible(find.text('Ticket 01'), 200);
    await tester.tap(find.text('Ticket 01'));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('de probabilidad conjunta estimada'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox());
  });
}
