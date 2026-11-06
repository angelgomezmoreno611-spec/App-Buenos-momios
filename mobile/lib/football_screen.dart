import 'package:flutter/material.dart';
import 'api.dart';
import 'football_models.dart';
import 'models.dart';

const _muted = Color(0xFF9BAAB9);
String _failure(Object error) => error.toString().startsWith('Exception: ')
    ? error.toString().substring(11)
    : 'No se pudo consultar la información. Revisa tu conexión y vuelve a intentar.';

class FootballScreen extends StatefulWidget {
  final Api api;
  const FootballScreen({super.key, required this.api});
  @override
  State<FootballScreen> createState() => _FootballScreenState();
}

class _FootballScreenState extends State<FootballScreen> {
  List<Json> _sources = [];
  String? _provider, _competition, _error;
  int _season = DateTime.now().year;
  DateTime _date = DateTime.now().toUtc();
  bool _loading = true;
  Json? _result;
  Json? get _source =>
      _sources.where((source) => source['id'] == _provider).firstOrNull;
  String get _day =>
      '${_date.year}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  Future<void> _initialize() async {
    try {
      final data = await widget.api.footballSources();
      final sources = footballMaps(data['sources']);
      final selected = sources
          .where((source) => source['enabled'] == true)
          .firstOrNull;
      if (!mounted) return;
      setState(() {
        _sources = sources;
        _provider = selected?['id'] as String?;
        _competition = selected == null
            ? null
            : footballMaps(selected['competitions']).firstOrNull?['id']
                  as String?;
        _season = data['defaultSeason'] as int? ?? _season;
        _loading = false;
        if (selected == null) {
          _error = 'Todavía no hay fuentes de partidos disponibles.';
        }
      });
      if (selected != null) await _load();
    } catch (error) {
      if (mounted) {
        setState(() {
          _error = _failure(error);
          _loading = false;
        });
      }
    }
  }

  Future<void> _load() async {
    if (_loading || _provider == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await widget.api.footballMatches(
        provider: _provider!,
        competition: _competition,
        season: _season,
        date: _day,
      );
      if (mounted) setState(() => _result = result);
    } catch (error) {
      if (mounted) setState(() => _error = _failure(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: DateTime(2000),
      lastDate: DateTime(DateTime.now().year + 1, 12, 31),
    );
    if (date == null || !mounted) return;
    setState(() {
      _date = date;
      _result = null;
    });
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final source = _source;
    final matches = footballMaps(
      _result?['matches'],
    ).map(FootballMatch.new).toList();
    final warnings = List<String>.from(_result?['warnings'] as List? ?? []);
    return RefreshIndicator(
      onRefresh: _sources.isEmpty ? _initialize : _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(22),
        children: [
          const Text(
            'Más fútbol.\nMás información.',
            style: TextStyle(
              fontSize: 32,
              height: 1.1,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 14),
          const Text(
            'Consulta partidos, resultados y fichas de distintas fuentes.',
            style: TextStyle(color: _muted, height: 1.5),
          ),
          const SizedBox(height: 24),
          if (Api.demo) ...[
            const _Info(
              'MODO DEMOSTRACIÓN · Partidos y estadísticas inventados',
            ),
            const SizedBox(height: 18),
          ],
          if (_sources.isNotEmpty) ...[
            DropdownButtonFormField<String>(
              key: ValueKey('source:$_provider'),
              initialValue: _provider,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Fuente de información',
              ),
              items: _sources
                  .map(
                    (item) => DropdownMenuItem(
                      value: item['id'] as String,
                      enabled: item['enabled'] == true,
                      child: Text(
                        '${item['name']}${item['enabled'] == true ? '' : ' · sin acceso'}',
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: _loading
                  ? null
                  : (value) {
                      final selected = _sources.firstWhere(
                        (source) => source['id'] == value,
                      );
                      setState(() {
                        _provider = value;
                        _competition =
                            footballMaps(
                                  selected['competitions'],
                                ).firstOrNull?['id']
                                as String?;
                        _result = null;
                      });
                      _load();
                    },
            ),
            const SizedBox(height: 16),
          ],
          if (source != null) ...[
            DropdownButtonFormField<String>(
              key: ValueKey('competition:$_provider:$_competition'),
              initialValue: _competition,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Competición'),
              items: footballMaps(source['competitions'])
                  .map(
                    (item) => DropdownMenuItem(
                      value: item['id'] as String,
                      child: Text(
                        item['name'] as String,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: _loading
                  ? null
                  : (value) {
                      setState(() {
                        _competition = value;
                        _result = null;
                      });
                      _load();
                    },
            ),
            const SizedBox(height: 16),
            if (source['season'] == true) ...[
              DropdownButtonFormField<int>(
                initialValue: _season,
                decoration: const InputDecoration(
                  labelText: 'Año de inicio de temporada',
                ),
                items: [
                  for (var year = DateTime.now().year; year >= 2000; year--)
                    DropdownMenuItem(value: year, child: Text('$year')),
                ],
                onChanged: _loading
                    ? null
                    : (value) {
                        if (value == null) return;
                        setState(() {
                          _season = value;
                          _result = null;
                        });
                        _load();
                      },
              ),
              const SizedBox(height: 16),
            ],
            if (source['date'] == true) ...[
              OutlinedButton.icon(
                onPressed: _loading ? null : _pickDate,
                icon: const Icon(Icons.calendar_month),
                label: Text('Fecha (UTC): $_day'),
              ),
              const SizedBox(height: 16),
            ],
            _Info(source['note'] as String? ?? ''),
            const SizedBox(height: 18),
          ],
          if (_loading) const LinearProgressIndicator(),
          if (_error != null) ...[
            const SizedBox(height: 16),
            _Info(_error!),
            TextButton.icon(
              onPressed: _loading
                  ? null
                  : _sources.isEmpty
                  ? _initialize
                  : _load,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
          if (_result != null) ...[
            const SizedBox(height: 18),
            Text(
              'Fuente: ${_result!['source']} · ${matches.length} de ${_result!['totalMatches'] ?? matches.length} partidos',
              style: const TextStyle(color: _muted, fontSize: 12),
            ),
            if (_result!['fetchedAt'] is String)
              Text(
                'Consultado: ${kickoffLabel(DateTime.parse(_result!['fetchedAt'] as String).toLocal())}',
                style: const TextStyle(color: _muted, fontSize: 11),
              ),
            const SizedBox(height: 12),
            if (!_loading && matches.isEmpty && _error == null)
              const _Info(
                'Esta fuente no devolvió partidos para la selección. Prueba otra fecha, temporada o fuente.',
              ),
            for (final match in matches)
              Card(
                margin: const EdgeInsets.only(bottom: 12),
                child: ListTile(
                  contentPadding: const EdgeInsets.all(16),
                  title: Text(
                    '${match.home} vs ${match.away}',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      '${match.league}\n${match.timeLabel}\n${match.statusLabel} · ${match.scoreLabel}',
                      style: const TextStyle(height: 1.6, color: _muted),
                    ),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push<void>(
                    MaterialPageRoute(
                      builder: (_) => FootballDetailScreen(
                        api: widget.api,
                        provider: _provider!,
                        id: match.id,
                        competition: _competition,
                        season: _season,
                        date: _day,
                      ),
                    ),
                  ),
                ),
              ),
            for (final warning in warnings)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  warning,
                  style: const TextStyle(
                    color: _muted,
                    fontSize: 12,
                    height: 1.5,
                  ),
                ),
              ),
          ],
          if (_sources.any((source) => source['enabled'] != true)) ...[
            const SizedBox(height: 24),
            ExpansionTile(
              title: const Text('Otras fuentes'),
              children: [
                for (final item in _sources.where(
                  (source) => source['enabled'] != true,
                ))
                  ListTile(
                    title: Text(item['name'] as String),
                    subtitle: Text(
                      item['note'] as String? ?? 'Acceso pendiente.',
                    ),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 24),
        ],
      ),
    );
  }
}

class FootballDetailScreen extends StatefulWidget {
  final Api api;
  final String provider, id;
  final String? competition, date;
  final int? season;
  const FootballDetailScreen({
    super.key,
    required this.api,
    required this.provider,
    required this.id,
    this.competition,
    this.season,
    this.date,
  });
  @override
  State<FootballDetailScreen> createState() => _FootballDetailScreenState();
}

class _FootballDetailScreenState extends State<FootballDetailScreen> {
  late Future<Json> _future;
  @override
  void initState() {
    super.initState();
    _future = _load();
  }

  Future<Json> _load() => widget.api.footballMatch(
    provider: widget.provider,
    id: widget.id,
    competition: widget.competition,
    season: widget.season,
    date: widget.date,
  );
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Ficha del partido')),
    body: FutureBuilder<Json>(
      future: _future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_failure(snapshot.error!)),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () => setState(() => _future = _load()),
                    child: const Text('Reintentar'),
                  ),
                ],
              ),
            ),
          );
        }
        final data = snapshot.data!,
            match = FootballMatch(data['match'] as Json);
        return ListView(
          padding: const EdgeInsets.all(24),
          children: [
            Text(
              '${match.home}\n${match.scoreLabel}\n${match.away}',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w800,
                height: 1.5,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              '${match.league} · ${match.statusLabel}\n${match.timeLabel}',
              textAlign: TextAlign.center,
              style: const TextStyle(color: _muted, height: 1.7),
            ),
            const SizedBox(height: 22),
            if (match.venue != null) _Info('Estadio: ${match.venue}'),
            if (match.referee != null) _Info('Árbitro: ${match.referee}'),
            if (match.round != null) _Info(match.round!),
            const SizedBox(height: 22),
            const Text(
              'Estadísticas',
              style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            if (match.statistics.isEmpty)
              const _Info(
                'Esta fuente no ofrece estadísticas para este partido o plan.',
              ),
            for (final stat in match.statistics)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Row(
                  children: [
                    SizedBox(
                      width: 46,
                      child: Text(
                        '${stat['home'] ?? '—'}',
                        textAlign: TextAlign.center,
                      ),
                    ),
                    Expanded(
                      child: Text(
                        stat['name'] as String,
                        textAlign: TextAlign.center,
                      ),
                    ),
                    SizedBox(
                      width: 46,
                      child: Text(
                        '${stat['away'] ?? '—'}',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ],
                ),
              ),
            for (final lineup in match.lineups.where(
              (lineup) => (lineup['players'] as List).isNotEmpty,
            )) ...[
              const SizedBox(height: 22),
              Text(
                'Alineación · ${lineup['team']}',
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (lineup['formation'] != '')
                Text(
                  '${lineup['formation']}',
                  style: const TextStyle(color: _muted),
                ),
              const SizedBox(height: 12),
              for (final player in lineup['players'] as List)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Text('$player'),
                ),
            ],
            if (match.events.isNotEmpty) ...[
              const SizedBox(height: 22),
              const Text(
                'Eventos',
                style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
              ),
              for (final event in match.events)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(event),
                ),
            ],
            if (match.odds.isNotEmpty) ...[
              const SizedBox(height: 22),
              const Text(
                'Cuotas · Over/Under 2.5',
                style: TextStyle(fontSize: 21, fontWeight: FontWeight.w700),
              ),
              for (final odd in match.odds)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(odd['bookmaker'] as String),
                  subtitle: Text(
                    'Over: ${odd['over'] ?? '—'} · Under: ${odd['under'] ?? '—'}\nActualizado: ${odd['updatedAt'] ?? 'Sin confirmar'}',
                  ),
                ),
              const _Info(
                'Cuotas informativas. El modelo de tickets no calcula valor esperado con estas cuotas.',
              ),
            ],
            const SizedBox(height: 24),
            Text(
              'Fuente: ${data['source']}',
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
            if (data['sourceUrl'] is String)
              SelectableText(
                data['sourceUrl'] as String,
                style: const TextStyle(color: _muted, fontSize: 12),
              ),
            for (final warning in data['warnings'] as List? ?? [])
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(
                  '$warning',
                  style: const TextStyle(color: _muted, height: 1.5),
                ),
              ),
            const SizedBox(height: 24),
          ],
        );
      },
    ),
  );
}

class _Info extends StatelessWidget {
  final String text;
  const _Info(this.text);
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1D282D),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text,
        style: const TextStyle(color: _muted, fontSize: 12, height: 1.6),
      ),
    ),
  );
}
