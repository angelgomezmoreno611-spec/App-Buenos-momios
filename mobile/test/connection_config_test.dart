import 'package:flutter_test/flutter_test.dart';
import 'package:buenos_momios/connection_config.dart';

void main() {
  String? validate({
    String supabaseUrl = 'https://example.supabase.co',
    String key = 'sb_publishable_test',
    String api = 'https://api.example.com',
    bool debug = false,
    bool local = false,
  }) => connectionError(
    supabaseUrl: supabaseUrl,
    publishableKey: key,
    apiUrl: api,
    debugMode: debug,
    allowLocalApi: local,
  );

  test(
    'acepta URL HTTPS y clave pública; rechaza configuración incompleta o privada',
    () {
      expect(validate(), isNull);
      expect(validate(supabaseUrl: ''), isNotNull);
      expect(validate(supabaseUrl: 'http://example.supabase.co'), isNotNull);
      expect(validate(key: ''), isNotNull);
      expect(validate(key: 'sb_secret_test'), contains('servidor'));
      expect(validate(api: ''), isNotNull);
      expect(validate(api: 'https://user:password@api.example.com'), isNotNull);
    },
  );

  test('HTTP local exige modo debug y autorización explícita', () {
    expect(
      validate(api: 'http://localhost:3000', debug: true, local: true),
      isNull,
    );
    expect(
      validate(api: 'http://127.0.0.1:3000', debug: true, local: true),
      isNull,
    );
    expect(validate(api: 'http://localhost:3000', debug: true), isNotNull);
    expect(validate(api: 'http://localhost:3000', local: true), isNotNull);
    expect(
      validate(api: 'http://api.example.com', debug: true, local: true),
      isNotNull,
    );
    expect(
      validate(api: 'http://localhost.example.com', debug: true, local: true),
      isNotNull,
    );
  });
}
