import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:buenos_momios/api.dart';
import 'package:buenos_momios/models.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUp(() {
    rootBundle.clear();
    SharedPreferences.setMockInitialValues({});
  });

  test(
    'historial demo persistente sin duplicados ni cambios de selección',
    () async {
      final api = Api();
      addTearDown(api.close);
      final batch = (await api.tickets())!;
      expect(await api.history(), isEmpty);
      await api.saveBatch(batch);
      await api.saveBatch(batch);

      final reopened = Api();
      addTearDown(reopened.close);
      final saved = await reopened.history();
      expect(saved, hasLength(1));
      expect(saved.single.data, equals(batch.data));
      expect(saved.single.tickets, hasLength(4));
      expect(
        saved.single.tickets.expand((ticket) => ticket.picks),
        hasLength(16),
      );
    },
  );

  test(
    'historial demo retiene las últimas 14 tandas y excluye datos reales',
    () async {
      final api = Api();
      addTearDown(api.close);
      final template = (await api.tickets())!;
      for (var i = 0; i < 16; i++) {
        await api.saveBatch(Batch({...template.data, 'id': 'demo-$i'}));
      }
      final saved = await api.history();
      expect(saved, hasLength(14));
      expect(saved.first.id, 'demo-15');
      expect(saved.last.id, 'demo-2');
      await expectLater(
        api.saveBatch(Batch({...template.data, 'mode': 'live'})),
        throwsArgumentError,
      );
      expect(await api.history(), hasLength(14));
    },
  );
}
