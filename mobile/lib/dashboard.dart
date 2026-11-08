import 'dart:async';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'api.dart';
import 'models.dart';
import 'notifications.dart';
import 'football_screen.dart';

const lime = Color(0xFFC4F566);
const muted = Color(0xFF9BAAB9);
const border = Color(0xFF283340);

class Dashboard extends StatefulWidget {
  const Dashboard({super.key});
  @override
  State<Dashboard> createState() => _DashboardState();
}

class _DashboardState extends State<Dashboard> with WidgetsBindingObserver {
  final _api = Api();
  late final PushService _push = PushService(_api);
  Batch? _batch;
  List<Batch> _history = [];
  bool _loading = false, _historyLoading = false, _alertBusy = false;
  bool _saveBusy = false;
  String? _savedBatchId;
  int _tab = 0;
  String? _error, _historyError, _pushError;
  StreamSubscription<RemoteMessage>? _foreground, _opened;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _start();
  }

  Future<void> _start() async {
    try {
      await _push.initialize();
      if (!mounted) return;
      if (!Api.demo && PushService.enabled && PushService.supported) {
        _foreground = FirebaseMessaging.onMessage.listen((message) {
          _notice(message.notification?.body ?? 'Se actualizó un ticket.');
          _load();
        });
        _opened = FirebaseMessaging.onMessageOpenedApp.listen(
          _openNotification,
        );
        final initial = await FirebaseMessaging.instance.getInitialMessage();
        if (initial != null && mounted) unawaited(_openNotification(initial));
      }
    } catch (_) {
      _pushError =
          'No se pudo iniciar Firebase. Revisa su configuración para activar avisos.';
    }
    if (!mounted) return;
    await _load();
    if (mounted && !Api.demo) {
      _timer = Timer.periodic(const Duration(seconds: 90), (_) {
        if (WidgetsBinding.instance.lifecycleState ==
            AppLifecycleState.resumed) {
          _load();
        }
      });
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _load();
  }

  Future<void> _load() async {
    if (_loading || !mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final batch = await _api.tickets();
      if (!mounted) return;
      setState(() => _batch = batch);
      if (batch != null) {
        try {
          await _push.follow(batch.id);
        } catch (_) {
          _notice(
            'No se pudo actualizar el registro de avisos. Vuelve a intentarlo.',
          );
        }
      }
    } catch (_) {
      if (mounted) {
        setState(
          () => _error =
              'No se pudieron actualizar los tickets. Revisa tu conexión y vuelve a intentar.',
        );
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadHistory() async {
    if (_historyLoading || !mounted) return;
    setState(() {
      _historyLoading = true;
      _historyError = null;
    });
    try {
      final history = await _api.history();
      if (mounted) setState(() => _history = history);
    } catch (_) {
      if (mounted) {
        setState(() => _historyError = 'No se pudo cargar el historial.');
      }
    } finally {
      if (mounted) setState(() => _historyLoading = false);
    }
  }

  Future<void> _openNotification(RemoteMessage message) async {
    await _loadHistory();
    if (!mounted) return;
    final id = message.data['ticketId'];
    for (final batch in [_batch, ..._history].whereType<Batch>()) {
      for (final ticket in batch.tickets) {
        if (ticket.id == id) {
          _showTicket(ticket);
          return;
        }
      }
    }
    _notice('Consulta el historial para ver el resultado del ticket.');
  }

  void _notice(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  Future<void> _saveBatch() async {
    final batch = _batch;
    if (_saveBusy || batch == null || batch.tickets.isEmpty) return;
    setState(() => _saveBusy = true);
    try {
      await _api.saveBatch(batch);
      if (!mounted) return;
      setState(() => _savedBatchId = batch.id);
      _notice(
        Api.demo
            ? 'Tanda demo guardada en este dispositivo.'
            : 'Tanda guardada en tu historial.',
      );
      if (_tab == 1) await _loadHistory();
    } catch (_) {
      _notice('No se pudo guardar la tanda. Vuelve a intentarlo.');
    } finally {
      if (mounted) setState(() => _saveBusy = false);
    }
  }

  Future<void> _toggleAlerts() async {
    if (_alertBusy) return;
    if (_pushError != null) {
      _notice(_pushError!);
      return;
    }
    final batch = _batch;
    if (batch == null) {
      _notice('Espera a que se publique una tanda de tickets.');
      return;
    }
    setState(() => _alertBusy = true);
    try {
      if (_push.active) {
        await _push.deactivate();
        _notice('Avisos desactivados en este teléfono.');
      } else {
        await _push.activate(batch.id);
        _savedBatchId = batch.id;
        _notice('Te avisaremos cuando se confirme un ticket acertado.');
      }
    } catch (e) {
      _notice(e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _alertBusy = false);
    }
  }

  Future<void> _logout() async {
    try {
      await _push.deactivate();
      await Supabase.instance.client.auth.signOut();
    } catch (_) {
      _notice(
        'No se pudo cerrar la sesión. Inténtalo de nuevo para desvincular los avisos.',
      );
    }
  }

  void _showTicket(Ticket ticket) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: const Color(0xFF111821),
      builder: (context) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.88,
        maxChildSize: 0.95,
        minChildSize: 0.4,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.all(24),
          children: [
            Center(
              child: Container(
                width: 36,
                height: 4,
                decoration: BoxDecoration(
                  color: muted,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Expanded(
                  child: Text(
                    ticket.title,
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                StatusPill(ticket.status),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: SelectableText(
                    ticket.id,
                    style: const TextStyle(fontSize: 11, color: muted),
                  ),
                ),
                IconButton(
                  tooltip: 'Copiar ID',
                  onPressed: () {
                    Clipboard.setData(ClipboardData(text: ticket.id));
                    _notice('ID copiado.');
                  },
                  icon: const Icon(Icons.copy, size: 18),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              '${percent(ticket.probability)} de probabilidad conjunta estimada',
              style: const TextStyle(color: lime, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 6),
            Text(
              'Equivale a acertar aproximadamente ${oneIn(ticket.probability)} veces.',
              style: const TextStyle(fontWeight: FontWeight.w600),
            ),
            const SizedBox(height: 6),
            Text(
              [
                'Supone independencia entre partidos.',
                if (_batch?.evidence != null) _batch!.evidence!.summary,
                ticket.isRisky
                    ? 'Ticket de alto riesgo: 2 over 3.5 (4 goles o más) y 2 over 2.5 (3 goles o más) en 90 minutos más descuento.'
                    : 'Over ${ticket.lineLabel} significa ${ticket.picks.isEmpty ? 2 : ticket.picks.first.goalsNeeded} goles o más en 90 minutos más descuento.',
              ].join(' '),
              style: const TextStyle(color: muted, height: 1.5),
            ),
            const SizedBox(height: 24),
            for (final pick in ticket.picks) ...[
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: const Color(0xFF19232E),
                  borderRadius: BorderRadius.circular(18),
                  border: Border.all(color: border),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${pick.league} · ${kickoffLabel(pick.kickoff)}',
                      style: const TextStyle(color: muted, fontSize: 12),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      '${pick.home}\nvs ${pick.away}',
                      style: const TextStyle(
                        fontSize: 21,
                        fontWeight: FontWeight.w700,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 12,
                      runSpacing: 10,
                      children: [
                        Label('OVER ${pick.lineLabel}', color: lime),
                        Label(percent(pick.probability)),
                        StatusPill(pick.result),
                        if (pick.score != null) Label(pick.score!),
                      ],
                    ),
                    const SizedBox(height: 16),
                    for (final reason in pick.reasons)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Text(
                          '• $reason',
                          style: const TextStyle(color: muted, height: 1.5),
                        ),
                      ),
                    if (pick.result == 'review')
                      const Text(
                        'Aplazamiento, cancelación o marcador incompleto: revisar las reglas de la casa de apuestas.',
                        style: TextStyle(color: Color(0xFFF3BD74)),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],
            const Text(
              'El estado refleja los resultados del proveedor. La liquidación económica depende de tu casa de apuestas.',
              style: TextStyle(color: muted, fontSize: 12, height: 1.5),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _foreground?.cancel();
    _opened?.cancel();
    _push.dispose();
    _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      backgroundColor: const Color(0xFF0C1117),
      centerTitle: false,
      toolbarHeight: 76,
      title: const Row(
        children: [
          Icon(Icons.sports_soccer, color: lime, size: 27),
          SizedBox(width: 10),
          Text(
            'buenos momios',
            style: TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 20,
              letterSpacing: -0.7,
            ),
          ),
        ],
      ),
      actions: [
        IconButton(
          tooltip: _push.active ? 'Desactivar avisos' : 'Activar avisos',
          onPressed: _alertBusy ? null : _toggleAlerts,
          icon: Icon(
            _push.active
                ? Icons.notifications_active_outlined
                : Icons.notifications_none_rounded,
            color: _push.active ? lime : muted,
          ),
        ),
        const SizedBox(width: 12),
      ],
    ),
    body: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 1080),
        child: switch (_tab) {
          1 => _historyView(),
          2 => _aboutView(),
          3 => FootballScreen(api: _api),
          _ => _todayView(),
        },
      ),
    ),
    bottomNavigationBar: NavigationBar(
      selectedIndex: _tab,
      onDestinationSelected: (index) {
        setState(() => _tab = index);
        if (index == 1) _loadHistory();
      },
      destinations: const [
        NavigationDestination(
          icon: Icon(Icons.confirmation_number_outlined),
          selectedIcon: Icon(Icons.confirmation_number),
          label: 'Mis tickets',
        ),
        NavigationDestination(icon: Icon(Icons.history), label: 'Historial'),
        NavigationDestination(
          icon: Icon(Icons.insights_outlined),
          label: 'El análisis',
        ),
        NavigationDestination(
          icon: Icon(Icons.sports_soccer_outlined),
          label: 'Partidos',
        ),
      ],
    ),
  );

  Widget _todayView() => RefreshIndicator(
    onRefresh: _load,
    color: lime,
    child: ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(22, 12, 22, 32),
      children: [
        if (Api.demo)
          const Notice(
            'MODO DEMOSTRACIÓN · Datos inventados',
            icon: Icons.science_outlined,
          ),
        const SizedBox(height: 24),
        const Text(
          'QUE HABLEN\nLOS GOLES.',
          style: TextStyle(
            fontSize: 42,
            fontWeight: FontWeight.w900,
            height: 1.04,
            letterSpacing: -1.8,
          ),
        ),
        const SizedBox(height: 16),
        const Text(
          'Selecciones con datos. Cada partido, una razón.',
          style: TextStyle(color: muted, height: 1.5),
        ),
        const SizedBox(height: 24),
        Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF263827), Color(0xFF16252B)],
            ),
            border: Border.all(color: const Color(0xFF394D34)),
            borderRadius: BorderRadius.circular(22),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'UN SOLO MERCADO',
                      style: TextStyle(
                        color: lime,
                        fontSize: 10,
                        letterSpacing: 2,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 9),
                    Text(
                      'Over ${_batch?.lineLabel ?? '1.5'}',
                      style: const TextStyle(
                        fontSize: 30,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${_batch?.goalsNeeded ?? 2} goles o más · 90 min + descuento',
                      style: const TextStyle(color: muted, fontSize: 11),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Column(
                children: [
                  Text(
                    '${_batch?.regularTickets.length ?? 0}/4',
                    style: const TextStyle(
                      color: lime,
                      fontSize: 32,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const Text(
                    'TICKETS',
                    style: TextStyle(
                      color: muted,
                      fontSize: 10,
                      letterSpacing: 1.3,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 30),
        Row(
          children: [
            const Expanded(
              child: Text(
                'Tu selección',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              ),
            ),
            IconButton(
              tooltip: 'Actualizar tickets',
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh, color: muted),
            ),
          ],
        ),
        if (_batch != null)
          Text(
            '${_batch!.day} · ${_batch!.regularTickets.length * _batch!.legs + (_batch!.riskyTicket == null ? 0 : 4)} partidos únicos',
            style: const TextStyle(color: muted, fontSize: 12),
          ),
        const SizedBox(height: 18),
        if (_batch != null && _batch!.tickets.isNotEmpty) ...[
          OutlinedButton.icon(
            onPressed: _saveBusy || _savedBatchId == _batch!.id
                ? null
                : _saveBatch,
            icon: Icon(
              _savedBatchId == _batch!.id
                  ? Icons.bookmark_added
                  : Icons.bookmark_add_outlined,
            ),
            label: Text(
              _saveBusy
                  ? 'Guardando…'
                  : _savedBatchId == _batch!.id
                  ? 'Tanda guardada'
                  : 'Guardar tanda',
            ),
          ),
          const SizedBox(height: 18),
        ],
        if (_loading)
          const Padding(
            padding: EdgeInsets.only(bottom: 18),
            child: LinearProgressIndicator(color: lime),
          ),
        if (_error != null) ...[
          Notice(_error!, icon: Icons.wifi_off),
          const SizedBox(height: 20),
        ],
        if (_batch == null && !_loading && _error == null)
          const Notice(
            'Todavía no se ha publicado el análisis de hoy. Actualiza más tarde.',
            icon: Icons.hourglass_empty,
          ),
        if (_batch != null) ...[
          LayoutBuilder(
            builder: (context, constraints) {
              final width = constraints.maxWidth > 700
                  ? (constraints.maxWidth - 18) / 2
                  : constraints.maxWidth;
              return Wrap(
                spacing: 18,
                runSpacing: 18,
                children: [
                  for (final ticket in _batch!.regularTickets)
                    SizedBox(
                      width: width,
                      child: TicketCard(
                        ticket: ticket,
                        onTap: () => _showTicket(ticket),
                      ),
                    ),
                  for (var i = _batch!.regularTickets.length; i < 4; i++)
                    SizedBox(width: width, child: _emptyTicket(i + 1)),
                  // El arriesgado va aparte, al final, para no confundirlo.
                  if (_batch!.riskyTicket != null)
                    SizedBox(
                      width: width,
                      child: TicketCard(
                        ticket: _batch!.riskyTicket!,
                        onTap: () => _showTicket(_batch!.riskyTicket!),
                      ),
                    ),
                ],
              );
            },
          ),
          if (_batch!.missing > 0)
            Padding(
              padding: const EdgeInsets.only(top: 18),
              child: Notice(
                'Faltan ${_batch!.missing} partidos que superen los filtros para completar 4 tickets de ${_batch!.legs}. No se bajó el umbral.',
                icon: Icons.filter_alt_outlined,
              ),
            ),
          const SizedBox(height: 22),
          Text(
            _batch!.source,
            style: const TextStyle(color: muted, fontSize: 11),
          ),
        ],
        const SizedBox(height: 18),
        const Text(
          'Probabilidades estimadas por un modelo inicial sin calibrar. Ningún ticket tiene una ganancia garantizada.',
          style: TextStyle(color: muted, fontSize: 12, height: 1.6),
        ),
      ],
    ),
  );

  Widget _emptyTicket(int number) => Container(
    padding: const EdgeInsets.all(24),
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(22),
      border: Border.all(color: border),
    ),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Ticket 0$number',
          style: const TextStyle(
            fontSize: 20,
            fontWeight: FontWeight.w700,
            color: muted,
          ),
        ),
        const SizedBox(height: 18),
        const Icon(Icons.filter_alt_outlined, size: 30, color: muted),
        const SizedBox(height: 12),
        const Text(
          'Sin suficientes partidos',
          style: TextStyle(fontWeight: FontWeight.w600),
        ),
        const SizedBox(height: 6),
        Text(
          'Se necesitan ${_batch?.legs ?? 6} selecciones más que pasen los filtros.',
          style: const TextStyle(color: muted, height: 1.5),
        ),
      ],
    ),
  );

  Widget _historyView() => RefreshIndicator(
    onRefresh: _loadHistory,
    child: ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(22),
      children: [
        const Text(
          'Cada ticket\ntiene historia.',
          style: TextStyle(
            fontSize: 34,
            fontWeight: FontWeight.w800,
            height: 1.15,
          ),
        ),
        const SizedBox(height: 18),
        Text(
          Api.demo
              ? 'Últimas 14 tandas demo guardadas en este dispositivo. Conservan la selección de ejemplo.'
              : 'Últimas 14 tandas guardadas. El ID conserva la selección original y los resultados se actualizan al consultar.',
          style: const TextStyle(color: muted, height: 1.5),
        ),
        const SizedBox(height: 24),
        if (Api.demo) ...[
          const Notice(
            'MODO DEMOSTRACIÓN · Historial local con datos inventados',
            icon: Icons.science_outlined,
          ),
          const SizedBox(height: 18),
        ],
        if (_historyLoading) const LinearProgressIndicator(color: lime),
        if (_historyError != null)
          Notice(_historyError!, icon: Icons.error_outline),
        if (!_historyLoading && _historyError == null && _history.isEmpty)
          Notice(
            Api.demo
                ? 'Guarda una tanda demo desde Mis tickets para verla aquí. Se conserva en este dispositivo.'
                : 'Guarda una tanda desde Mis tickets para verla aquí.',
            icon: Icons.history,
          ),
        for (final batch in _history) ...[
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 20),
            child: Text(
              batch.day,
              style: const TextStyle(color: lime, fontWeight: FontWeight.w700),
            ),
          ),
          for (final ticket in batch.tickets)
            Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: TicketCard(
                ticket: ticket,
                onTap: () => _showTicket(ticket),
              ),
            ),
        ],
      ],
    ),
  );

  Widget _aboutView() => ListView(
    padding: const EdgeInsets.all(24),
    children: [
      const Label('DETRÁS DE LA SELECCIÓN', color: lime),
      const SizedBox(height: 22),
      const Text(
        'Una razón para\ncada partido.',
        style: TextStyle(
          fontSize: 34,
          fontWeight: FontWeight.w800,
          height: 1.15,
        ),
      ),
      const SizedBox(height: 26),
      const _Explanation(
        '01',
        'Goles y forma reciente',
        'El modelo analiza lo que cada equipo anota y concede. Los partidos recientes pesan más que los antiguos.',
      ),
      const _Explanation(
        '02',
        'Local y visitante',
        'Compara al local jugando en casa y al visitante jugando fuera. Suaviza las muestras con los promedios de su liga.',
      ),
      _Explanation(
        '03',
        'Filtros antes que cantidad',
        'Exige historial suficiente, actividad reciente y una probabilidad mínima. Cada ticket tiene ${_batch?.legs ?? 6} partidos y ninguna tanda repite un encuentro.',
      ),
      _Explanation(
        '04',
        'Resultados confirmados',
        'Un ticket se marca acertado cuando sus ${_batch?.legs ?? 6} partidos finalizan con al menos ${_batch?.goalsNeeded ?? 2} goles. Aplazados y cancelados pasan a revisión.',
      ),
      Notice(
        _batch?.evidence != null
            ? '${_batch!.evidence!.summary} No es una garantía futura: ${_batch!.legs} selecciones de ${percent(_batch!.evidence!.hitRate)} acertarían juntas ${oneIn(_batch!.evidence!.ticketPicks(_batch!.legs))} veces.'
            : 'Un porcentaje histórico no es una garantía futura. Seis selecciones de 85% acertarían juntas 1 de cada 3 veces si fueran independientes.',
        icon: Icons.info_outline,
      ),
      const SizedBox(height: 24),
      const Text(
        'Lo que todavía falta validar',
        style: TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
      ),
      const SizedBox(height: 12),
      const Text(
        'El modelo combina Poisson y frecuencia histórica de goles. Se midió con temporadas que no usó para ajustarse; una calibración adicional y otros parámetros no mejoraron el resultado. Solo aprende de marcadores: no conoce cuotas, lesiones, alineaciones ni xG, y no calcula si una apuesta ofrece buen valor.',
        style: TextStyle(color: muted, height: 1.7),
      ),
      if (_batch != null) ...[
        const SizedBox(height: 18),
        for (final warning in _batch!.warnings)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(
              '• $warning',
              style: const TextStyle(color: muted, height: 1.5),
            ),
          ),
      ],
      const SizedBox(height: 20),
      OutlinedButton.icon(
        onPressed: _alertBusy ? null : _toggleAlerts,
        icon: const Icon(Icons.notifications_outlined),
        label: Text(
          _push.active ? 'Desactivar avisos' : 'Activar avisos de tickets',
        ),
      ),
      if (!Api.demo)
        TextButton(onPressed: _logout, child: const Text('Cerrar sesión')),
      const SizedBox(height: 20),
    ],
  );
}

class TicketCard extends StatelessWidget {
  final Ticket ticket;
  final VoidCallback onTap;
  const TicketCard({super.key, required this.ticket, required this.onTap});
  @override
  Widget build(BuildContext context) => Material(
    color: const Color(0xFF151D27),
    borderRadius: BorderRadius.circular(22),
    child: InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(22),
      child: Container(
        padding: const EdgeInsets.all(21),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(22),
          border: Border.all(
            color: ticket.isRisky ? Colors.orangeAccent : border,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(9),
                  decoration: BoxDecoration(
                    color: (ticket.isRisky ? Colors.orangeAccent : lime)
                        .withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    ticket.isRisky
                        ? Icons.local_fire_department_outlined
                        : Icons.confirmation_number_outlined,
                    color: ticket.isRisky ? Colors.orangeAccent : lime,
                    size: 21,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    ticket.title,
                    style: const TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
                StatusPill(ticket.status),
              ],
            ),
            const SizedBox(height: 12),
            Text(
              'ID ${ticket.id.substring(0, 8)} · ${ticket.legs} selecciones',
              style: const TextStyle(
                color: muted,
                fontSize: 11,
                letterSpacing: 0.4,
              ),
            ),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 14),
              child: Divider(color: border, height: 1),
            ),
            for (final pick in ticket.picks)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 9),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 29,
                      height: 29,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: const Color(0xFF26333D),
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: Text(
                        pick.home.substring(0, 1),
                        style: const TextStyle(
                          color: Color(0xFF72CBBB),
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ),
                    const SizedBox(width: 11),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${pick.home} vs ${pick.away}',
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          const SizedBox(height: 5),
                          Text(
                            pick.score == null
                                ? kickoffLabel(pick.kickoff)
                                : '${pick.score} · ${statusLabel(pick.result)}',
                            style: const TextStyle(fontSize: 10, color: muted),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      '+${pick.lineLabel}',
                      style: const TextStyle(
                        color: lime,
                        fontWeight: FontWeight.w700,
                        fontSize: 12,
                      ),
                    ),
                  ],
                ),
              ),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 15),
              child: Divider(color: border, height: 1),
            ),
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        percent(ticket.probability),
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        'Conjunta estimada* · ~${oneIn(ticket.probability)}',
                        style: const TextStyle(color: muted, fontSize: 10),
                      ),
                    ],
                  ),
                ),
                const Text(
                  'Ver análisis',
                  style: TextStyle(
                    color: lime,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(width: 7),
                const Icon(Icons.arrow_forward, color: lime, size: 18),
              ],
            ),
            const SizedBox(height: 12),
            const Text(
              '*Supone independencia. Modelo sin calibrar.',
              style: TextStyle(color: muted, fontSize: 9),
            ),
          ],
        ),
      ),
    ),
  );
}

class Label extends StatelessWidget {
  final String text;
  final Color color;
  const Label(this.text, {super.key, this.color = muted});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(7),
    ),
    child: Text(
      text,
      style: TextStyle(
        color: color,
        fontSize: 10,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.4,
      ),
    ),
  );
}

class StatusPill extends StatelessWidget {
  final String status;
  const StatusPill(this.status, {super.key});
  @override
  Widget build(BuildContext context) => Label(
    statusLabel(status),
    color: switch (status) {
      'won' => lime,
      'lost' => const Color(0xFFED9793),
      'review' => const Color(0xFFF3BD74),
      _ => muted,
    },
  );
}

class Notice extends StatelessWidget {
  final String text;
  final IconData icon;
  const Notice(this.text, {super.key, required this.icon});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: const Color(0xFF1D282D),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: border),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 19, color: lime),
        const SizedBox(width: 12),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(color: muted, fontSize: 12, height: 1.6),
          ),
        ),
      ],
    ),
  );
}

class _Explanation extends StatelessWidget {
  final String number, title, description;
  const _Explanation(this.number, this.title, this.description);
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 28),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          number,
          style: const TextStyle(
            color: lime,
            fontSize: 14,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(width: 18),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                description,
                style: const TextStyle(color: muted, height: 1.6),
              ),
            ],
          ),
        ),
      ],
    ),
  );
}
