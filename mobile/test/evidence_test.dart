import 'package:buenos_momios/models.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('oneIn expresa probabilidades como frecuencia', () {
    expect(oneIn(0.185), '1 de cada 5');
    expect(oneIn(0.43), '1 de cada 2');
    expect(oneIn(1), '1 de cada 1');
    expect(oneIn(0), 'casi nunca');
  });

  test('el lote lee la evidencia del modelo si existe', () {
    final base = {'warnings': <String>[], 'tickets': <Map>[]};
    expect(Batch(base).evidence, isNull);
    final batch = Batch({
      ...base,
      'evidence': {
        'period': '2024-25',
        'leagues': 'Cinco ligas',
        'threshold': 0.65,
        'picks': 154,
        'hitRate': 0.656,
      },
    });
    expect(
      batch.evidence!.summary,
      'En 2024-25 (Cinco ligas), los partidos con 65.0% o más acertaron el 65.6% de 154.',
    );
    expect(oneIn(batch.evidence!.fourPicks), '1 de cada 5');
  });

  test('el lote lee mercado y tamaño, con valores antiguos por defecto', () {
    final old = Batch({'warnings': <String>[], 'tickets': <Map>[]});
    expect([old.lineLabel, old.legs, old.goalsNeeded], ['2.5', 4, 3]);
    final now = Batch({
      'warnings': <String>[],
      'line': 1.5,
      'legs': 6,
      'tickets': [
        {
          'id': 't',
          'number': 1,
          'status': 'pending',
          'probability': 0.4,
          'selections': List.generate(6, (_) => {'market': 'OVER_1_5'}),
        },
      ],
    });
    expect([now.lineLabel, now.legs, now.goalsNeeded], ['1.5', 6, 2]);
    expect([now.tickets.first.legs, now.tickets.first.lineLabel], [6, '1.5']);
    final e = Evidence({'hitRate': 0.85});
    expect(oneIn(e.ticketPicks(6)), '1 de cada 3');
  });

  test('el ticket arriesgado se separa y muestra mercados mixtos', () {
    Map<String, dynamic> pick(String m) => {'market': m};
    final batch = Batch({
      'warnings': <String>[],
      'line': 1.5,
      'legs': 6,
      'tickets': [
        {
          'id': 'a',
          'number': 1,
          'status': 'pending',
          'probability': 0.4,
          'selections': List.generate(6, (_) => pick('OVER_1_5')),
        },
        {
          'id': 'b',
          'number': 2,
          'kind': 'risky',
          'name': 'El arriesgado del día',
          'status': 'pending',
          'probability': 0.08,
          'selections': [
            pick('OVER_3_5'),
            pick('OVER_3_5'),
            pick('OVER_2_5'),
            pick('OVER_2_5'),
          ],
        },
      ],
    });
    expect(batch.regularTickets.length, 1);
    final risky = batch.riskyTicket!;
    expect([risky.title, risky.lineLabel, risky.legs], ['El arriesgado del día', 'mixto', 4]);
    expect(risky.picks.map((p) => p.goalsNeeded).toList(), [4, 4, 3, 3]);
    expect(batch.regularTickets.first.title, 'Ticket 01');
  });
}
