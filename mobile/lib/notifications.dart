import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';

@pragma('vm:entry-point')
Future<void> backgroundMessage(RemoteMessage message) async {
  await Firebase.initializeApp();
}

class PushService {
  static const enabled = bool.fromEnvironment('ENABLE_PUSH');
  static bool get supported =>
      !kIsWeb &&
      (defaultTargetPlatform == TargetPlatform.android ||
          defaultTargetPlatform == TargetPlatform.iOS);
  final Api api;
  PushService(this.api);
  StreamSubscription<String>? _refresh;
  String? _batchId;
  String? _token;
  bool _active = false;
  bool get active => _active;

  Future<void> initialize() async {
    if (Api.demo || !enabled || !supported) return;
    if (Firebase.apps.isEmpty) await Firebase.initializeApp();
    FirebaseMessaging.onBackgroundMessage(backgroundMessage);
    final preferences = await SharedPreferences.getInstance();
    _active = preferences.getBool('alertsEnabled') ?? false;
    _refresh = FirebaseMessaging.instance.onTokenRefresh.listen((token) async {
      _token = token;
      if (_active && _batchId != null) {
        try {
          await _subscribe(token);
        } catch (_) {
          /* Reintentar en la próxima carga. */
        }
      }
    });
  }

  Future<void> follow(String batchId) async {
    _batchId = batchId;
    if (!_active || Api.demo || !enabled || !supported) return;
    final token = await FirebaseMessaging.instance.getToken();
    if (token == null) {
      throw Exception('El teléfono aún no tiene token de notificaciones.');
    }
    _token = token;
    await _subscribe(token);
  }

  Future<void> _subscribe(String token) => api.subscribe(
    _batchId!,
    token,
    defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android',
  );
  Future<void> activate(String batchId) async {
    if (Api.demo) {
      throw Exception(
        'La demo no envía notificaciones. Configura el modo real.',
      );
    }
    if (!enabled || !supported) {
      throw Exception(
        'Las notificaciones requieren la configuración de Firebase en Android o iOS.',
      );
    }
    final permission = await FirebaseMessaging.instance.requestPermission();
    if (![
      AuthorizationStatus.authorized,
      AuthorizationStatus.provisional,
    ].contains(permission.authorizationStatus)) {
      throw Exception(
        'Activa las notificaciones en los ajustes de tu teléfono.',
      );
    }
    _batchId = batchId;
    _token = await FirebaseMessaging.instance.getToken();
    if (_token == null) {
      throw Exception('No se pudo registrar el teléfono. Inténtalo de nuevo.');
    }
    await _subscribe(_token!);
    _active = true;
    await (await SharedPreferences.getInstance()).setBool(
      'alertsEnabled',
      true,
    );
  }

  Future<void> deactivate() async {
    if (!Api.demo && enabled && supported) {
      final token = _token ?? await FirebaseMessaging.instance.getToken();
      if (token != null) await api.removeDevice(token);
    }
    _active = false;
    await (await SharedPreferences.getInstance()).setBool(
      'alertsEnabled',
      false,
    );
  }

  void dispose() => _refresh?.cancel();
}
