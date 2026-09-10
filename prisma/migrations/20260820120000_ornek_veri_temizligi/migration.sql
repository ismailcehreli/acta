-- Örnek (demo) verinin temizlenebilmesi için fiziksel silme yasağına
-- **dar bir kapı**.
--
-- Arka plan: `20260817153720_esszamanlilik_ve_silme_engeli` fiziksel silmeyi
-- tetikleyiciyle yasakladı. Bu doğru kuraldır ve kalır: kullanıcı ve birim
-- pasifleştirilir, faaliyet iptal edilir. Sessiz silme tarihsel raporlamayı
-- ve denetim izini geri döndürülemez biçimde bozar.
--
-- Ancak örnek veri bir iş kaydı değil, deneme malzemesidir (ürün sahibi
-- kararı, 20.08.2026). Onu pasifleştirmek sistemi temizlemez, yalnızca çöpü
-- görünmez yapar: sayaçlar, arama ve kapsam akışı örnek kayıtları saymaya
-- devam eder.
--
-- Kapı şöyle dar tutuldu:
--
--   * Yasak **varsayılan**. Tetikleyici yalnızca `app.demo_purge` oturum
--     değişkeni tam olarak 'evet' iken siliyor.
--   * Değişken `SET LOCAL` ile, **yalnız o transaction süresince** kuruluyor.
--     İşlem bitince kendiliğinden kalkar; bağlantı havuzunda bir sonraki
--     isteğe sızamaz.
--   * Uygulamada bu değişkeni kuran tek yer `src/server/demo/purge.ts`.
--     Başka hiçbir kod yolu silme yapamaz; yaptığı an tetikleyici durdurur.
--   * Silinen satır kümesi yine yalnızca `@ornek.test` hesaplarından
--     türetiliyor ve yabancı anahtarlar (RESTRICT) gerçek veriye
--     dokunulmasını ayrıca engelliyor.
--
-- Yani "kim silebilir" sorusunun cevabı değişmedi (yalnız sistem yöneticisi,
-- yalnız yönetim ekranından, yazarak onayla); değişen, o işlemin veritabanı
-- katmanında da mümkün hâle gelmesi.

CREATE OR REPLACE FUNCTION forbid_physical_delete() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  -- Örnek veri temizliği: yalnız transaction'a özel bayrak kurulmuşsa.
  IF current_setting('app.demo_purge', true) = 'evet' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION
    'PHYSICAL_DELETE_FORBIDDEN: % tablosundan kayıt silinemez; kullanıcı ve birim pasifleştirilir, faaliyet iptal edilir',
    TG_TABLE_NAME;
END;
$$;
