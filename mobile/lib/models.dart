typedef Json = Map<String, dynamic>;

class Batch {
  final Json data;
  Batch(this.data);
  String get id => data['id'] as String;
  String get day => data['day'] as String;
  bool get isDemo => data['mode'] == 'demo';
  String get source => data['source'] as String;
  int get missing => data['missingMatches'] as int;
  List<String> get warnings => List<String>.from(data['warnings'] as List);
  Evidence? get evidence => data['evidence'] is Map
      ? Evidence(Map<String, dynamic>.from(data['evidence'] as Map))
      : null;
  List<Ticket> get tickets => (data['tickets'] as List)
      .map((t) => Ticket(Map<String, dynamic>.from(t as Map)))
      .toList();
}

/// Acierto medido del modelo en una temporada que no usó para ajustarse.
class Evidence {
  final Json data;
  Evidence(this.data);
  String get period => data['period'] as String;
  String get leagues => data['leagues'] as String;
  double get threshold => (data['threshold'] as num).toDouble();
  int get picks => data['picks'] as int;
  double get hitRate => (data['hitRate'] as num).toDouble();
  // Cuatro selecciones con ese acierto, suponiendo independencia.
  double get fourPicks => hitRate * hitRate * hitRate * hitRate;
  String get summary =>
      'En $period ($leagues), los partidos con ${percent(threshold)} o más '
      'acertaron el ${percent(hitRate)} de $picks.';
}

class Ticket {
  final Json data;
  Ticket(this.data);
  String get id => data['id'] as String;
  int get number => data['number'] as int;
  String get status => data['status'] as String;
  double get probability => (data['probability'] as num).toDouble();
  List<Pick> get picks => (data['selections'] as List)
      .map((p) => Pick(Map<String, dynamic>.from(p as Map)))
      .toList();
}

class Pick {
  final Json data;
  Pick(this.data);
  Json get match => data['match'] as Json;
  Json get prediction => data['prediction'] as Json;
  String get home => (match['home'] as Json)['name'] as String;
  String get away => (match['away'] as Json)['name'] as String;
  String get league => (match['league'] as Json)['name'] as String;
  DateTime get kickoff => DateTime.parse(match['kickoff'] as String).toLocal();
  String get result => data['result'] as String;
  String? get score => data['score'] as String?;
  double get probability => (prediction['probability'] as num).toDouble();
  List<String> get reasons => List<String>.from(prediction['reasons'] as List);
}

String percent(double p) => '${(p * 100).toStringAsFixed(1)}%';

/// "1 de cada N" para explicar una probabilidad sin porcentajes.
String oneIn(double p) =>
    p <= 0 ? 'casi nunca' : '1 de cada ${(1 / p).round().clamp(1, 1000)}';
String statusLabel(String status) => switch (status) {
  'won' => 'Acertado',
  'lost' => 'No acertado',
  'review' => 'En revisión',
  _ => 'Pendiente',
};
String kickoffLabel(DateTime d) =>
    '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')} · ${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
