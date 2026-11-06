import 'dart:convert';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'models.dart';
import 'football_models.dart';

class Api {
  static const demo =
      String.fromEnvironment('APP_MODE', defaultValue: 'demo') == 'demo';
  static const _baseUrl = String.fromEnvironment('API_URL');
  static String get baseUrl => _baseUrl.trim().replaceFirst(RegExp(r'/+$'), '');
  static const _demoHistoryKey = 'demoSavedBatches';
  final http.Client _client;
  Api({http.Client? client}) : _client = client ?? http.Client();

  Future<Json> _request(
    String path, {
    String method = 'GET',
    Json? body,
  }) async {
    final token = Supabase.instance.client.auth.currentSession?.accessToken;
    if (token == null) {
      throw Exception('Tu sesión terminó. Inicia sesión de nuevo.');
    }
    final request = http.Request(method, Uri.parse('$baseUrl$path'))
      ..headers.addAll({
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      });
    if (body != null) request.body = jsonEncode(body);
    final stream = await _client
        .send(request)
        .timeout(const Duration(seconds: 20));
    final response = await http.Response.fromStream(
      stream,
    ).timeout(const Duration(seconds: 10));
    final data = jsonDecode(response.body) as Json;
    if (response.statusCode >= 400) {
      throw Exception(data['error'] ?? 'No se pudo consultar la API');
    }
    return data;
  }

  Future<Batch?> tickets() async {
    if (demo) {
      return Batch(
        jsonDecode(await rootBundle.loadString('assets/demo_batch.json'))
            as Json,
      );
    }
    final data = await _request('/api/tickets');
    return data['batch'] == null ? null : Batch(data['batch'] as Json);
  }

  Future<List<Batch>> history() async {
    if (demo) {
      final preferences = await SharedPreferences.getInstance();
      return (preferences.getStringList(_demoHistoryKey) ?? [])
          .map((value) => Batch(jsonDecode(value) as Json))
          .toList();
    }
    final data = await _request('/api/history');
    return (data['batches'] as List).map((x) => Batch(x as Json)).toList();
  }

  Future<void> saveBatch(Batch batch) async {
    if (demo) {
      if (!batch.isDemo) {
        throw ArgumentError('El historial demo solo admite datos de prueba.');
      }
      final saved = await history();
      if (saved.any((item) => item.id == batch.id)) return;
      final preferences = await SharedPreferences.getInstance();
      final stored = await preferences.setStringList(
        _demoHistoryKey,
        [
          batch,
          ...saved,
        ].take(14).map((item) => jsonEncode(item.data)).toList(),
      );
      if (!stored) {
        throw Exception('No se pudo guardar la tanda en este dispositivo.');
      }
      return;
    }
    await _request('/api/history', method: 'POST', body: {'batchId': batch.id});
  }

  Future<void> subscribe(String batchId, String token, String platform) async {
    await _request(
      '/api/subscriptions',
      method: 'POST',
      body: {'batchId': batchId, 'token': token, 'platform': platform},
    );
  }

  Future<void> removeDevice(String token) async {
    await _request('/api/devices', method: 'DELETE', body: {'token': token});
  }

  Future<Json> footballSources() async {
    if (demo) {
      return {
        'defaultSeason': DateTime.now().year,
        'sources': [
          {
            'id': 'demo',
            'name': 'Demostración',
            'enabled': true,
            'season': false,
            'date': false,
            'competitions': [
              {'id': 'demo', 'name': 'Liga de ejemplo'},
            ],
            'note': 'Equipos y estadísticas inventados.',
          },
        ],
      };
    }
    return _request('/api/football/sources');
  }

  Future<Json> footballMatches({
    required String provider,
    String? competition,
    int? season,
    String? date,
  }) async {
    if (demo) {
      final batch = (await tickets())!;
      return {
        'provider': 'demo',
        'source': 'Demostración',
        'fetchedAt': batch.data['createdAt'],
        'warnings': [
          'DEMOSTRACIÓN: equipos y estadísticas inventados. No son datos reales.',
        ],
        'matches': batch.tickets
            .expand((ticket) => ticket.picks)
            .map(
              (pick) => {
                'remoteId': pick.match['id'],
                'provider': 'demo',
                'home': pick.home,
                'away': pick.away,
                'league': pick.league,
                'kickoff': pick.match['kickoff'],
                'status': 'scheduled',
                'score': null,
                'venue': 'Estadio de ejemplo',
                'referee': null,
                'events': [],
                'lineups': [],
                'odds': [],
                'statistics': [
                  {'name': 'Remates (ejemplo)', 'home': '12', 'away': '9'},
                ],
              },
            )
            .toList(),
      };
    }
    return _request(
      _footballPath('matches', provider, competition, season, date),
    );
  }

  Future<Json> footballMatch({
    required String provider,
    required String id,
    String? competition,
    int? season,
    String? date,
  }) async {
    if (demo) {
      final data = await footballMatches(provider: provider);
      final match = footballMaps(
        data['matches'],
      ).firstWhere((match) => match['remoteId'] == id);
      return {
        for (final entry in data.entries)
          if (entry.key != 'matches') entry.key: entry.value,
        'match': match,
      };
    }
    return _request(
      _footballPath('match', provider, competition, season, date, id),
    );
  }

  String _footballPath(
    String path,
    String provider,
    String? competition,
    int? season,
    String? date, [
    String? id,
  ]) {
    final query = Uri(
      queryParameters: {
        'provider': provider,
        if (competition != null) 'competition': competition,
        if (season != null) 'season': '$season',
        if (date != null) 'date': date,
        if (id != null) 'id': id,
      },
    ).query;
    return '/api/football/$path?$query';
  }

  void close() => _client.close();
}
