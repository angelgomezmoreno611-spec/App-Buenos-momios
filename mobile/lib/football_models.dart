import 'models.dart';

List<Json> footballMaps(dynamic value) => (value is List ? value : [])
    .whereType<Map>()
    .map((row) => Map<String, dynamic>.from(row))
    .toList();

class FootballMatch {
  final Json data;
  FootballMatch(this.data);
  String get id => data['remoteId'] as String;
  String get home => data['home'] as String;
  String get away => data['away'] as String;
  String get league => data['league'] as String? ?? '';
  String? get venue => data['venue'] as String?;
  String? get referee => data['referee'] as String?;
  String? get round => data['round'] as String?;
  DateTime? get kickoff =>
      DateTime.tryParse(data['kickoff'] as String? ?? '')?.toLocal();
  String get timeLabel => kickoff != null
      ? kickoffLabel(kickoff!)
      : '${data['date'] ?? 'Fecha sin confirmar'} · Hora sin confirmar';
  String get scoreLabel {
    final score = data['score'];
    return score is Map ? '${score['home']}–${score['away']}' : 'vs';
  }

  String get statusLabel => switch (data['status']) {
    'finished' => 'Finalizado',
    'live' => 'En juego',
    'scheduled' => 'Programado',
    'postponed' => 'Aplazado',
    'cancelled' => 'Cancelado',
    _ => 'Sin confirmar',
  };
  List<Json> get statistics => footballMaps(data['statistics']);
  List<Json> get lineups => footballMaps(data['lineups']);
  List<Json> get odds => footballMaps(data['odds']);
  List<String> get events => List<String>.from(data['events'] as List? ?? []);
}
