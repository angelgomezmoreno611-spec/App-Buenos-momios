import 'package:flutter/material.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController(), _password = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _register = false, _busy = false;
  String? _message;
  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      if (_register) {
        final response = await Supabase.instance.client.auth.signUp(
          email: _email.text.trim(),
          password: _password.text,
        );
        if (mounted && response.session == null) {
          setState(
            () => _message =
                'Revisa tu correo para confirmar la cuenta y después inicia sesión.',
          );
        }
      } else {
        await Supabase.instance.client.auth.signInWithPassword(
          email: _email.text.trim(),
          password: _password.text,
        );
      }
    } on AuthException catch (e) {
      if (mounted) setState(() => _message = e.message);
    } catch (_) {
      if (mounted) {
        setState(
          () => _message =
              'No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.',
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(28),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Form(
            key: _form,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Icon(
                  Icons.sports_soccer,
                  size: 54,
                  color: Color(0xFFC4F566),
                ),
                const SizedBox(height: 28),
                Text(
                  'Buenos\nMomios.',
                  style: Theme.of(context).textTheme.displaySmall?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 12),
                const Text('Fútbol, datos y selecciones con una explicación.'),
                const SizedBox(height: 32),
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  decoration: const InputDecoration(
                    labelText: 'Correo electrónico',
                  ),
                  validator: (s) => s != null && s.contains('@')
                      ? null
                      : 'Escribe un correo válido',
                ),
                const SizedBox(height: 18),
                TextFormField(
                  controller: _password,
                  obscureText: true,
                  autofillHints: const [AutofillHints.password],
                  decoration: const InputDecoration(labelText: 'Contraseña'),
                  validator: (s) => s != null && s.length >= 8
                      ? null
                      : 'Usa al menos 8 caracteres',
                ),
                const SizedBox(height: 24),
                if (_message != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 18),
                    child: Text(_message!),
                  ),
                FilledButton(
                  onPressed: _busy ? null : _submit,
                  child: Text(
                    _busy
                        ? 'Conectando…'
                        : _register
                        ? 'Crear cuenta'
                        : 'Entrar',
                  ),
                ),
                TextButton(
                  onPressed: _busy
                      ? null
                      : () => setState(() {
                          _register = !_register;
                          _message = null;
                        }),
                  child: Text(
                    _register ? 'Ya tengo cuenta' : 'Crear una cuenta gratuita',
                  ),
                ),
                const SizedBox(height: 28),
                Text(
                  'Las probabilidades son estimaciones. Ningún resultado está garantizado.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
