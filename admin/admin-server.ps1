# ササゲパス サイト管理サーバー
# ダブルクリックで起動する start-admin.bat から呼び出されます。
# ローカル(localhost)のみで待ち受け、外部には公開されません。

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Web

$AdminDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$SiteRoot  = Split-Path -Parent $AdminDir
$IndexPath = Join-Path $SiteRoot "index.html"
$Port      = 8799

# ------------------------------------------------------------
# 編集セクションのグループ分け（IDの接頭辞→表示名）
# ------------------------------------------------------------
$GroupMap = [ordered]@{
    "hero"            = "ヒーロー"
    "flow"            = "ご利用の流れ"
    "svc-cleaning"    = "サービス：クリーニング"
    "svc-photo"       = "サービス：撮影"
    "svc-measurement" = "サービス：採寸"
    "svc-listing"     = "サービス：出品"
    "price"           = "料金表"
    "faq"             = "よくある質問"
    "contact"         = "お問い合わせ"
    "footer"          = "フッター"
}

function Get-GroupForId {
    param([string]$id)
    $best = ""
    foreach ($prefix in $GroupMap.Keys) {
        if ($id.StartsWith($prefix) -and $prefix.Length -gt $best.Length) { $best = $prefix }
    }
    if ($best -eq "") { return "その他" }
    return $GroupMap[$best]
}

# ------------------------------------------------------------
# HTMLエンティティの簡易エンコード/デコード（text型フィールド用）
# ------------------------------------------------------------
function ConvertTo-HtmlText {
    param([string]$s)
    return $s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
}
function ConvertFrom-HtmlText {
    param([string]$s)
    return $s.Replace("&lt;", "<").Replace("&gt;", ">").Replace("&amp;", "&")
}

# ------------------------------------------------------------
# タグの対応する閉じタグを探す（ネストを考慮）
# $html: 全体, $openTagEndPos: 開始タグ ">" の直後の位置, $tagName: 例 "p","div","ul"
# 戻り値: @{ InnerStart, InnerEnd, CloseTagEnd }
# ------------------------------------------------------------
function Find-MatchingClose {
    param([string]$html, [int]$openTagEndPos, [string]$tagName)

    $pattern = [regex]::new("<$tagName(?=[\s>])|</$tagName>", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    $depth = 1
    $pos = $openTagEndPos
    while ($true) {
        $m = $pattern.Match($html, $pos)
        if (-not $m.Success) {
            throw "Matching close tag for <$tagName> not found starting at $openTagEndPos"
        }
        if ($m.Value.StartsWith("</")) {
            $depth--
            if ($depth -eq 0) {
                return @{ InnerStart = $openTagEndPos; InnerEnd = $m.Index; CloseTagEnd = $m.Index + $m.Length }
            }
        } else {
            $depth++
        }
        $pos = $m.Index + $m.Length
    }
}

# ------------------------------------------------------------
# data-edit-id="X" の位置から、その要素のタグ名・内容範囲を求める
# ------------------------------------------------------------
function Get-EditableElementRange {
    param([string]$html, [int]$attrPos)

    # 属性位置から手前方向に最も近い "<" を探してタグ名を取得
    $ltPos = $html.LastIndexOf("<", $attrPos)
    if ($ltPos -lt 0) { throw "Opening '<' not found before position $attrPos" }
    $tagNameMatch = [regex]::Match($html.Substring($ltPos), '^<([a-zA-Z0-9]+)')
    if (-not $tagNameMatch.Success) { throw "Tag name not found at position $ltPos" }
    $tagName = $tagNameMatch.Groups[1].Value

    # 属性位置から先方向に、開始タグを閉じる ">" を探す
    $gtPos = $html.IndexOf(">", $attrPos)
    if ($gtPos -lt 0) { throw "Opening tag '>' not found after position $attrPos" }
    $openTagEndPos = $gtPos + 1

    $range = Find-MatchingClose -html $html -openTagEndPos $openTagEndPos -tagName $tagName
    $range["TagName"] = $tagName
    return $range
}

# ------------------------------------------------------------
# index.html を解析し、data-edit-id を持つ全フィールドを抽出
# ------------------------------------------------------------
function Get-Fields {
    param([string]$html)

    $fields = @()
    $attrRegex = [regex]'data-edit-id="([^"]+)"\s+data-edit-label="([^"]+)"\s+data-edit-type="([^"]+)"'
    foreach ($m in $attrRegex.Matches($html)) {
        $id    = $m.Groups[1].Value
        $label = $m.Groups[2].Value
        $type  = $m.Groups[3].Value

        $range = Get-EditableElementRange -html $html -attrPos $m.Index
        $inner = $html.Substring($range.InnerStart, $range.InnerEnd - $range.InnerStart)

        if ($type -eq "list") {
            $liRegex = [regex]'(?s)<li>\s*(<i[^>]*></i>)?\s*(.*?)\s*</li>'
            $lines = @()
            foreach ($li in $liRegex.Matches($inner)) {
                $lines += (ConvertFrom-HtmlText $li.Groups[2].Value.Trim())
            }
            $value = [string]::Join("`n", $lines)
        } elseif ($type -eq "richtext") {
            $value = $inner.Trim()
        } else {
            $value = ConvertFrom-HtmlText ($inner.Trim())
        }

        $fields += [ordered]@{
            id    = $id
            label = $label
            type  = $type
            group = (Get-GroupForId $id)
            value = $value
        }
    }
    return $fields
}

# ------------------------------------------------------------
# 1フィールド分の新しい内側HTMLを作る
# ------------------------------------------------------------
function Build-InnerHtml {
    param([string]$type, [string]$newValue, [string]$existingInner, [string]$baseIndent = "          ")

    if ($type -eq "list") {
        # 既存の <li> からアイコンHTMLを順番に取得し、新しい行数に合わせて再利用
        $liRegex = [regex]'(?s)<li>\s*(<i[^>]*></i>)?\s*(.*?)\s*</li>'
        $icons = @()
        foreach ($li in $liRegex.Matches($existingInner)) {
            $icons += $li.Groups[1].Value
        }
        if ($icons.Count -eq 0) { $icons = @('<i class="fa-solid fa-circle-check"></i>') }

        $lines = $newValue -split "`r?`n" | Where-Object { $_.Trim() -ne "" }
        $out = New-Object System.Text.StringBuilder
        [void]$out.Append("`n")
        for ($i = 0; $i -lt $lines.Count; $i++) {
            $icon = if ($i -lt $icons.Count) { $icons[$i] } else { $icons[$icons.Count - 1] }
            $text = ConvertTo-HtmlText $lines[$i].Trim()
            [void]$out.Append("$baseIndent  <li>$icon $text</li>`n")
        }
        [void]$out.Append("$baseIndent")
        return $out.ToString()
    } elseif ($type -eq "richtext") {
        return $newValue
    } else {
        return (ConvertTo-HtmlText $newValue)
    }
}

# ------------------------------------------------------------
# 変更内容を index.html に書き込む
# ------------------------------------------------------------
function Save-Fields {
    param([hashtable]$updates)  # id -> newValue

    $html = [System.IO.File]::ReadAllText($IndexPath, [System.Text.Encoding]::UTF8)
    $attrRegex = [regex]'data-edit-id="([^"]+)"\s+data-edit-label="([^"]+)"\s+data-edit-type="([^"]+)"'

    # 後ろから置換していくと、前方のインデックスがズレない
    # ($matches は -match 演算子が使う自動変数と衝突するため $attrMatches という名前にする)
    $attrMatches = @($attrRegex.Matches($html))
    for ($i = $attrMatches.Count - 1; $i -ge 0; $i--) {
        $m = $attrMatches[$i]
        $id = $m.Groups[1].Value
        if (-not $updates.ContainsKey($id)) { continue }

        $type = $m.Groups[3].Value
        $range = Get-EditableElementRange -html $html -attrPos $m.Index

        # 開始タグがある行の行頭インデントを取得（リスト再構築時のインデント合わせ用）
        $ltPos = $html.LastIndexOf("<", $m.Index)
        $lineStart = $html.LastIndexOf("`n", $ltPos) + 1
        $baseIndent = $html.Substring($lineStart, $ltPos - $lineStart)
        if ($baseIndent -match '\S') { $baseIndent = "          " }

        $existingInner = $html.Substring($range.InnerStart, $range.InnerEnd - $range.InnerStart)
        $newInner = Build-InnerHtml -type $type -newValue $updates[$id] -existingInner $existingInner -baseIndent $baseIndent

        $html = $html.Substring(0, $range.InnerStart) + $newInner + $html.Substring($range.InnerEnd)
    }

    # 改行コードを CRLF に統一（元ファイルとの余分な差分を防ぐ）
    $html = $html -replace "`r`n", "`n"
    $html = $html -replace "`n", "`r`n"

    [System.IO.File]::WriteAllText($IndexPath, $html, [System.Text.Encoding]::UTF8)
}

# ------------------------------------------------------------
# Git 公開
# ------------------------------------------------------------
function Publish-ToGit {
    Push-Location $SiteRoot
    # git は通常メッセージも標準エラーに出すため、2>&1 と組み合わせると
    # $ErrorActionPreference = "Stop" 環境では正常時にも例外化してしまう。
    # ここではローカルに Continue へ緩め、成否は $LASTEXITCODE で判定する。
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        # index.html 自体に変更があるかどうかだけを見る（リポジトリ全体の未追跡ファイルは無視）
        $diffOut = (& git diff --name-only -- index.html) -join "`n"
        $addOut  = (& git status --porcelain -- index.html) -join "`n"
        if ($diffOut.Trim() -eq "" -and $addOut.Trim() -eq "") {
            return @{ ok = $true; output = "変更はありませんでした（公開済みの内容と同じです）。" }
        }

        $addResult = (& git add index.html 2>&1) -join "`n"

        $commitResult = (& git commit -m "管理画面からサイト内容を更新" 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0) {
            return @{ ok = $false; output = "コミットに失敗しました:`n$commitResult" }
        }

        $pushResult = (& git push 2>&1) -join "`n"
        if ($LASTEXITCODE -ne 0) {
            return @{ ok = $false; output = "push に失敗しました:`n$pushResult" }
        }

        return @{ ok = $true; output = "$commitResult`n$pushResult" }
    } catch {
        return @{ ok = $false; output = $_.Exception.Message }
    } finally {
        $ErrorActionPreference = $prevEAP
        Pop-Location
    }
}

# ------------------------------------------------------------
# 簡易 MIME
# ------------------------------------------------------------
function Get-Mime {
    param([string]$path)
    switch ([System.IO.Path]::GetExtension($path).ToLower()) {
        ".html" { return "text/html; charset=utf-8" }
        ".css"  { return "text/css" }
        ".js"   { return "application/javascript" }
        default { return "application/octet-stream" }
    }
}

# ------------------------------------------------------------
# HTTP サーバー本体
# ------------------------------------------------------------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
try {
    $listener.Start()
} catch {
    Write-Output "サーバーの起動に失敗しました: $($_.Exception.Message)"
    Read-Host "Enterキーで終了"
    exit 1
}

Write-Output "============================================"
Write-Output " ササゲパス 管理画面サーバーを起動しました"
Write-Output " ブラウザで http://localhost:$Port/ を開いてください"
Write-Output " 終了するには、このウィンドウを閉じてください"
Write-Output "============================================"

try {
    Start-Process "http://localhost:$Port/"
} catch {}

while ($listener.IsListening) {
    $context = $listener.GetContext()
    $req = $context.Request
    $res = $context.Response
    try {
        $path = $req.Url.AbsolutePath

        if ($req.HttpMethod -eq "GET" -and ($path -eq "/" -or $path -eq "/admin.html")) {
            $bytes = [System.IO.File]::ReadAllBytes((Join-Path $AdminDir "admin.html"))
            $res.ContentType = "text/html; charset=utf-8"
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($req.HttpMethod -eq "GET" -and $path -eq "/api/fields") {
            $html = [System.IO.File]::ReadAllText($IndexPath, [System.Text.Encoding]::UTF8)
            $fields = Get-Fields -html $html
            $json = $fields | ConvertTo-Json -Depth 5
            if ($fields.Count -eq 1) { $json = "[$json]" }
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $res.ContentType = "application/json; charset=utf-8"
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($req.HttpMethod -eq "POST" -and $path -eq "/api/save") {
            $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $data = $body | ConvertFrom-Json
            $updates = @{}
            foreach ($prop in $data.PSObject.Properties) {
                $updates[$prop.Name] = [string]$prop.Value
            }
            Save-Fields -updates $updates
            $result = @{ ok = $true } | ConvertTo-Json
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($result)
            $res.ContentType = "application/json; charset=utf-8"
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        elseif ($req.HttpMethod -eq "POST" -and $path -eq "/api/publish") {
            $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            if ($body -and $body.Trim() -ne "") {
                $data = $body | ConvertFrom-Json
                $updates = @{}
                foreach ($prop in $data.PSObject.Properties) {
                    $updates[$prop.Name] = [string]$prop.Value
                }
                if ($updates.Count -gt 0) { Save-Fields -updates $updates }
            }
            $result = Publish-ToGit
            $json = $result | ConvertTo-Json
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $res.ContentType = "application/json; charset=utf-8"
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        else {
            $res.StatusCode = 404
            $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not Found")
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
    } catch {
        $res.StatusCode = 500
        $errJson = (@{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json)
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
        try { $res.OutputStream.Write($bytes, 0, $bytes.Length) } catch {}
    } finally {
        $res.OutputStream.Close()
    }
}
