/* ============================================================
   ササゲパス 計測タグ 共通スクリプト
   ------------------------------------------------------------
   LP（index.html）と見積ページ（mitsumori/index.html）の
   両方から読み込みます。IDの設定はこのファイルだけで完結します。

   ▼ 下の CONFIG に、取得したIDを貼り付けてください。
     空欄のままのタグは読み込まれないので、
     分かるものから順に埋めていけば大丈夫です。
   ============================================================ */

(function () {
  'use strict';

  var CONFIG = {
    // GA4の「測定ID」。G- から始まります。  例: 'G-XXXXXXXXXX'
    GA4_ID: 'G-BXM34QJ761',

    // Google広告の「コンバージョンID」。AW- から始まります。  例: 'AW-123456789'
    GOOGLE_ADS_ID: '',

    // Google広告の「コンバージョンラベル」。英数字の文字列です。
    // 例: 'AbC-D_efGhIjKlMnOp'
    GOOGLE_ADS_LABEL_ESTIMATE: '', // 見積フォーム 送信完了 用
    GOOGLE_ADS_LABEL_CONTACT: '',  // LPのお問い合わせ 送信完了 用

    // Metaピクセルの「ピクセルID」。数字だけの文字列です。 例: '1234567890123456'
    META_PIXEL_ID: ''
  };

  // ---- 以下は編集不要 ----------------------------------------

  window.SASAGE_TRACKING = CONFIG;

  function loadScript(src) {
    var s = document.createElement('script');
    s.async = true;
    s.src = src;
    document.head.appendChild(s);
  }

  /* ---------- Google (GA4 / Google広告) ---------- */
  var hasGoogle = !!(CONFIG.GA4_ID || CONFIG.GOOGLE_ADS_ID);

  if (hasGoogle) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());

    if (CONFIG.GA4_ID) window.gtag('config', CONFIG.GA4_ID);
    if (CONFIG.GOOGLE_ADS_ID) window.gtag('config', CONFIG.GOOGLE_ADS_ID);

    loadScript('https://www.googletagmanager.com/gtag/js?id=' +
      encodeURIComponent(CONFIG.GA4_ID || CONFIG.GOOGLE_ADS_ID));
  }

  /* ---------- Meta ピクセル ---------- */
  if (CONFIG.META_PIXEL_ID) {
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', CONFIG.META_PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  /* ============================================================
     sasageTrack(eventName)
     コンバージョンや行動イベントを各媒体へまとめて送ります。

       'estimate_submit' … 見積フォームの送信完了（最重要CV）
       'contact_submit'  … LPお問い合わせの送信完了（CV）
       'estimate_click'  … 「1分で料金チェック」クリック（中間指標）
     ============================================================ */
  var META_EVENT = {
    estimate_submit: 'Lead',
    contact_submit: 'Lead',
    estimate_click: 'InitiateCheckout'
  };

  var ADS_LABEL = {
    estimate_submit: 'GOOGLE_ADS_LABEL_ESTIMATE',
    contact_submit: 'GOOGLE_ADS_LABEL_CONTACT'
  };

  window.sasageTrack = function (eventName, params) {
    params = params || {};

    try {
      // GA4（カスタムイベントとして記録。GA4側でCV登録します）
      if (CONFIG.GA4_ID && window.gtag) {
        window.gtag('event', eventName, params);
      }

      // Google広告 コンバージョン
      var labelKey = ADS_LABEL[eventName];
      if (CONFIG.GOOGLE_ADS_ID && labelKey && CONFIG[labelKey] && window.gtag) {
        window.gtag('event', 'conversion', {
          send_to: CONFIG.GOOGLE_ADS_ID + '/' + CONFIG[labelKey]
        });
      }

      // Meta
      if (CONFIG.META_PIXEL_ID && window.fbq) {
        var metaEvent = META_EVENT[eventName];
        if (metaEvent) {
          window.fbq('track', metaEvent, { content_name: eventName });
        } else {
          window.fbq('trackCustom', eventName, params);
        }
      }
    } catch (e) {
      // 計測の失敗でサイトの動作を止めない
      if (window.console && console.warn) console.warn('[tracking]', e);
    }
  };

  /* ---------- 「1分で料金チェック」クリックの自動計測 ---------- */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    if (a.getAttribute('href').indexOf('/mitsumori') === -1) return;
    window.sasageTrack('estimate_click');
  }, true);
})();
