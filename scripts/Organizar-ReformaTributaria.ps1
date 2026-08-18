<#
.SINOPSE
    Organiza por MÓDULO a pasta do curso "Reforma Tributária do Consumo" (Receita Federal)
    e baixa os materiais que estiverem faltando, direto do site da Receita.

.DESCRIÇÃO
    O script faz, nesta ordem:
      1. INVENTÁRIO   - lista tudo o que já existe na pasta local.
      2. RASPAGEM     - lê a página "Módulos do Curso" da Receita Federal e monta a lista
                        oficial de módulos e de materiais (PDF, PPTX, DOCX, ZIP, MP4).
      3. PASTAS       - cria uma pasta por módulo ("Módulo 01 - <título>").
      4. CLASSIFICAÇÃO- move os arquivos que você já tem para a pasta do módulo correto.
                        O que não der para identificar vai para "_NAO_CLASSIFICADOS".
      5. DOWNLOAD     - baixa só o que estiver faltando, cada um na pasta do seu módulo.
      6. RELATÓRIO    - grava _RELATORIO.csv e _RELATORIO.md na raiz da pasta.

    Por segurança, o script roda em MODO SIMULAÇÃO por padrão: ele mostra tudo o que faria
    sem mover nem baixar nada. Só executa de verdade com o parâmetro -Executar.

.EXEMPLO
    # 1) Primeiro rode a simulação e confira o relatório:
    .\Organizar-ReformaTributaria.ps1

    # 2) Se estiver certo, execute de verdade:
    .\Organizar-ReformaTributaria.ps1 -Executar

    # 3) Se quiser organizar sem baixar nada da internet:
    .\Organizar-ReformaTributaria.ps1 -Executar -SemDownload

.OBSERVAÇÕES
    - Requer Windows PowerShell 5.1 (o que já vem no Windows) ou PowerShell 7+.
    - Se a pasta estiver no OneDrive, os arquivos precisam estar disponíveis localmente
      ("Sempre manter neste dispositivo") para serem movidos sem erro.
#>

[CmdletBinding()]
param(
    # Pasta raiz do curso na sua máquina.
    [string] $Raiz = 'C:\Users\jurid\OneDrive\Área de Trabalho\TRANSFERIR PARA NOVO NOTE\AÇÕES JUDICIAIS\GUEU\PROTOCOLAR\REFORMA TRIBUTÁRIA DE CONSUMO',

    # Página oficial com os módulos do curso.
    [string] $Url = 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/curso/material-de-apoio/modulos-do-curso',

    # Sem este parâmetro o script apenas SIMULA (não move e não baixa nada).
    [switch] $Executar,

    # Organiza a pasta local, mas não baixa nada da internet.
    [switch] $SemDownload
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36'
$ExtensoesMaterial = @('.pdf', '.pptx', '.ppt', '.docx', '.doc', '.zip', '.mp4', '.xlsx', '.csv')
$PastaNaoClassificados = '_NAO_CLASSIFICADOS'

# ----------------------------------------------------------------------------------
# Funções auxiliares
# ----------------------------------------------------------------------------------

function Escrever-Titulo([string] $Texto) {
    Write-Host ''
    Write-Host ('=' * 78) -ForegroundColor DarkCyan
    Write-Host "  $Texto" -ForegroundColor Cyan
    Write-Host ('=' * 78) -ForegroundColor DarkCyan
}

# Remove acentos e pontuação para comparar nomes de arquivo de forma tolerante.
function Normalizar([string] $Texto) {
    if ([string]::IsNullOrWhiteSpace($Texto)) { return '' }
    $decomposto = $Texto.Normalize([Text.NormalizationForm]::FormD)
    $semAcento = -join ($decomposto.ToCharArray() | Where-Object {
        [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [Globalization.UnicodeCategory]::NonSpacingMark
    })
    return ($semAcento -replace '[^A-Za-z0-9]', '').ToLowerInvariant()
}

# Deixa o texto válido como nome de pasta/arquivo no Windows.
function Limpar-NomeArquivo([string] $Texto, [int] $Maximo = 90) {
    $limpo = $Texto -replace '\s+', ' '
    foreach ($c in [IO.Path]::GetInvalidFileNameChars()) {
        $limpo = $limpo.Replace($c, '-')
    }
    $limpo = $limpo.Trim(' ', '.', '-')
    if ($limpo.Length -gt $Maximo) { $limpo = $limpo.Substring(0, $Maximo).Trim() }
    return $limpo
}

function Remover-Tags([string] $Html) {
    $texto = $Html -replace '<[^>]+>', ' '
    $texto = [Net.WebUtility]::HtmlDecode($texto)
    return ($texto -replace '\s+', ' ').Trim()
}

# Extrai o número do módulo de um texto livre ("Módulo 3 - ...", "MÓDULO III", "M03").
function Obter-NumeroModulo([string] $Texto) {
    if ($Texto -match '(?i)m[oó]dulo\s*0*(\d{1,2})')      { return [int] $Matches[1] }
    if ($Texto -match '(?i)\bm[_\-\s]?0*(\d{1,2})\b')      { return [int] $Matches[1] }
    $romanos = @{ 'i'=1;'ii'=2;'iii'=3;'iv'=4;'v'=5;'vi'=6;'vii'=7;'viii'=8;'ix'=9;'x'=10;'xi'=11;'xii'=12 }
    if ($Texto -match '(?i)m[oó]dulo\s+([ivx]{1,5})\b') {
        $chave = $Matches[1].ToLowerInvariant()
        if ($romanos.ContainsKey($chave)) { return $romanos[$chave] }
    }
    return $null
}

function Baixar-Pagina([string] $Endereco) {
    try {
        return (Invoke-WebRequest -Uri $Endereco -UseBasicParsing -UserAgent $UserAgent -TimeoutSec 60).Content
    } catch {
        Write-Warning "Não consegui ler a página: $Endereco  ($($_.Exception.Message))"
        return $null
    }
}

# ----------------------------------------------------------------------------------
# 1. INVENTÁRIO DO QUE JÁ EXISTE
# ----------------------------------------------------------------------------------

Escrever-Titulo 'ETAPA 1 - Inventário da pasta local'

if (-not (Test-Path -LiteralPath $Raiz)) {
    throw "A pasta não foi encontrada: $Raiz"
}
Write-Host "Pasta: $Raiz"

$arquivosLocais = Get-ChildItem -LiteralPath $Raiz -Recurse -File |
    Where-Object { $_.Name -notlike '_RELATORIO.*' -and $_.Name -ne 'Organizar-ReformaTributaria.ps1' }

Write-Host ("Arquivos encontrados: {0}" -f $arquivosLocais.Count) -ForegroundColor Yellow
foreach ($a in $arquivosLocais) {
    $relativo = $a.FullName.Substring($Raiz.Length).TrimStart('\', '/')
    Write-Host ("   - {0}  ({1:N0} KB)" -f $relativo, ($a.Length / 1KB))
}

# ----------------------------------------------------------------------------------
# 2. RASPAGEM DA PÁGINA DA RECEITA FEDERAL
# ----------------------------------------------------------------------------------

Escrever-Titulo 'ETAPA 2 - Lendo os módulos no site da Receita Federal'

$modulos  = @{}   # numero -> titulo
$materiais = @()  # objetos com Modulo, Titulo, Url, NomeArquivo

$html = Baixar-Pagina $Url

if ($null -eq $html) {
    Write-Warning 'Sem acesso ao site. O script vai apenas organizar o que já existe localmente.'
} else {
    $padrao = '(?is)(?<h><h[1-6][^>]*>(?<htext>.*?)</h[1-6]>)|(?<a><a\s[^>]*href\s*=\s*["''](?<href>[^"'']+)["''][^>]*>(?<atext>.*?)</a>)'
    $moduloAtual = $null
    $subpaginas  = @()

    foreach ($m in [regex]::Matches($html, $padrao)) {
        if ($m.Groups['h'].Success) {
            $texto = Remover-Tags $m.Groups['htext'].Value
            $num   = Obter-NumeroModulo $texto
            if ($null -ne $num) {
                $moduloAtual = $num
                if (-not $modulos.ContainsKey($num)) { $modulos[$num] = $texto }
            }
            continue
        }

        $href  = [Net.WebUtility]::HtmlDecode($m.Groups['href'].Value)
        $rotulo = Remover-Tags $m.Groups['atext'].Value
        if ([string]::IsNullOrWhiteSpace($href) -or $href.StartsWith('#') -or $href.StartsWith('mailto:')) { continue }

        $absoluto = try { ([Uri]::new([Uri]$Url, $href)).AbsoluteUri } catch { continue }
        $extensao = [IO.Path]::GetExtension(([Uri]$absoluto).AbsolutePath).ToLowerInvariant()

        # Alguns links do gov.br terminam em /@@download/file — usa o rótulo como nome.
        $ehMaterial = $ExtensoesMaterial -contains $extensao -or $absoluto -match '@@download'

        $numDoRotulo = Obter-NumeroModulo $rotulo
        if ($null -eq $numDoRotulo) { $numDoRotulo = Obter-NumeroModulo $absoluto }

        if ($ehMaterial) {
            $numero = if ($null -ne $numDoRotulo) { $numDoRotulo } elseif ($null -ne $moduloAtual) { $moduloAtual } else { 0 }
            if ($numero -gt 0 -and -not $modulos.ContainsKey($numero)) { $modulos[$numero] = "Módulo $numero" }

            $nome = [IO.Path]::GetFileName(([Uri]$absoluto).AbsolutePath)
            if ([string]::IsNullOrWhiteSpace($nome) -or $nome -eq 'file') {
                $nome = (Limpar-NomeArquivo $rotulo) + $(if ($extensao) { $extensao } else { '.pdf' })
            }

            $materiais += [pscustomobject]@{
                Modulo      = $numero
                Titulo      = if ($rotulo) { $rotulo } else { $nome }
                Url         = $absoluto
                NomeArquivo = $nome
            }
        }
        elseif ($null -ne $numDoRotulo -and ([Uri]$absoluto).Host -eq ([Uri]$Url).Host) {
            if (-not $modulos.ContainsKey($numDoRotulo)) { $modulos[$numDoRotulo] = $rotulo }
            $subpaginas += [pscustomobject]@{ Modulo = $numDoRotulo; Url = $absoluto }
        }
    }

    # Entra uma vez em cada subpágina de módulo para pegar os arquivos de lá.
    foreach ($sub in ($subpaginas | Sort-Object Url -Unique)) {
        Write-Host ("   Abrindo módulo {0}: {1}" -f $sub.Modulo, $sub.Url) -ForegroundColor DarkGray
        $htmlSub = Baixar-Pagina $sub.Url
        if ($null -eq $htmlSub) { continue }

        foreach ($m in [regex]::Matches($htmlSub, '(?is)<a\s[^>]*href\s*=\s*["''](?<href>[^"'']+)["''][^>]*>(?<atext>.*?)</a>')) {
            $href = [Net.WebUtility]::HtmlDecode($m.Groups['href'].Value)
            if ([string]::IsNullOrWhiteSpace($href) -or $href.StartsWith('#')) { continue }
            $absoluto = try { ([Uri]::new([Uri]$sub.Url, $href)).AbsoluteUri } catch { continue }
            $extensao = [IO.Path]::GetExtension(([Uri]$absoluto).AbsolutePath).ToLowerInvariant()
            if (-not ($ExtensoesMaterial -contains $extensao -or $absoluto -match '@@download')) { continue }

            $rotulo = Remover-Tags $m.Groups['atext'].Value
            $nome   = [IO.Path]::GetFileName(([Uri]$absoluto).AbsolutePath)
            if ([string]::IsNullOrWhiteSpace($nome) -or $nome -eq 'file') {
                $nome = (Limpar-NomeArquivo $rotulo) + $(if ($extensao) { $extensao } else { '.pdf' })
            }

            $materiais += [pscustomobject]@{
                Modulo      = $sub.Modulo
                Titulo      = if ($rotulo) { $rotulo } else { $nome }
                Url         = $absoluto
                NomeArquivo = $nome
            }
        }
    }

    $materiais = $materiais | Sort-Object Url -Unique
    Write-Host ("Módulos identificados no site: {0}" -f $modulos.Count) -ForegroundColor Yellow
    Write-Host ("Materiais identificados:       {0}" -f $materiais.Count) -ForegroundColor Yellow

    if ($modulos.Count -eq 0 -and $materiais.Count -eq 0) {
        Write-Warning 'A página não devolveu links de material (pode ser carregada por JavaScript).'
        Write-Warning 'Salve a página como HTML e me envie, ou informe as URLs diretas dos PDFs.'
    }
}

# ----------------------------------------------------------------------------------
# 3. CRIAÇÃO DAS PASTAS POR MÓDULO
# ----------------------------------------------------------------------------------

Escrever-Titulo 'ETAPA 3 - Criando as pastas por módulo'

$pastaDoModulo = @{}
foreach ($num in ($modulos.Keys | Sort-Object)) {
    $nomePasta = Limpar-NomeArquivo ("Módulo {0:D2} - {1}" -f $num, ($modulos[$num] -replace '(?i)^m[oó]dulo\s*0*\d+\s*[-–:]?\s*', ''))
    $caminho   = Join-Path $Raiz $nomePasta
    $pastaDoModulo[$num] = $caminho

    if (Test-Path -LiteralPath $caminho) {
        Write-Host "   [existe]  $nomePasta" -ForegroundColor DarkGray
    } elseif ($Executar) {
        New-Item -ItemType Directory -Path $caminho | Out-Null
        Write-Host "   [criada]  $nomePasta" -ForegroundColor Green
    } else {
        Write-Host "   [criaria] $nomePasta" -ForegroundColor Yellow
    }
}

$caminhoNaoClassificados = Join-Path $Raiz $PastaNaoClassificados
if ($Executar -and -not (Test-Path -LiteralPath $caminhoNaoClassificados)) {
    New-Item -ItemType Directory -Path $caminhoNaoClassificados | Out-Null
}

# ----------------------------------------------------------------------------------
# 4. CLASSIFICAÇÃO DOS ARQUIVOS QUE VOCÊ JÁ TEM
# ----------------------------------------------------------------------------------

Escrever-Titulo 'ETAPA 4 - Separando os arquivos que já estão na pasta'

# Índice: nome normalizado do material do site -> módulo
$indicePorNome = @{}
foreach ($mat in $materiais) {
    $chave = Normalizar ([IO.Path]::GetFileNameWithoutExtension($mat.NomeArquivo))
    if ($chave -and -not $indicePorNome.ContainsKey($chave)) { $indicePorNome[$chave] = $mat.Modulo }
    $chaveTitulo = Normalizar $mat.Titulo
    if ($chaveTitulo -and -not $indicePorNome.ContainsKey($chaveTitulo)) { $indicePorNome[$chaveTitulo] = $mat.Modulo }
}

$relatorio = @()
# Caminhos que passarão a existir após a Etapa 4 (usado para a simulação não mentir na Etapa 5).
$destinosPrevistos = @{}

foreach ($arquivo in $arquivosLocais) {
    # Já está dentro de uma pasta de módulo? Então deixa quieto.
    $jaOrganizado = $false
    foreach ($p in $pastaDoModulo.Values) {
        if ($arquivo.FullName.StartsWith($p, [StringComparison]::OrdinalIgnoreCase)) { $jaOrganizado = $true; break }
    }
    if ($jaOrganizado) {
        $relatorio += [pscustomobject]@{ Acao='ja-organizado'; Modulo=''; Arquivo=$arquivo.Name; Destino=$arquivo.DirectoryName; Origem='local' }
        continue
    }

    $baseNome = [IO.Path]::GetFileNameWithoutExtension($arquivo.Name)
    $numero   = Obter-NumeroModulo $arquivo.Name

    if ($null -eq $numero) {
        $chave = Normalizar $baseNome
        if ($indicePorNome.ContainsKey($chave)) { $numero = $indicePorNome[$chave] }
    }
    if ($null -eq $numero) {
        # Tenta pelo nome da subpasta em que o arquivo está.
        $numero = Obter-NumeroModulo $arquivo.Directory.Name
    }

    $destino = if ($null -ne $numero -and $pastaDoModulo.ContainsKey($numero)) {
        $pastaDoModulo[$numero]
    } elseif ($null -ne $numero) {
        $novo = Join-Path $Raiz (Limpar-NomeArquivo ("Módulo {0:D2}" -f $numero))
        if ($Executar -and -not (Test-Path -LiteralPath $novo)) { New-Item -ItemType Directory -Path $novo | Out-Null }
        $pastaDoModulo[$numero] = $novo
        $novo
    } else {
        $caminhoNaoClassificados
    }

    $rotuloModulo = if ($null -ne $numero) { "{0:D2}" -f $numero } else { '?' }
    $alvo = Join-Path $destino $arquivo.Name

    if ($arquivo.FullName -ieq $alvo) { continue }

    if (Test-Path -LiteralPath $alvo) {
        Write-Host ("   [duplicado] {0} já existe em {1}" -f $arquivo.Name, (Split-Path $destino -Leaf)) -ForegroundColor DarkYellow
        $relatorio += [pscustomobject]@{ Acao='duplicado'; Modulo=$rotuloModulo; Arquivo=$arquivo.Name; Destino=$destino; Origem='local' }
        continue
    }

    $destinosPrevistos[$alvo] = $true
    if ($Executar) {
        Move-Item -LiteralPath $arquivo.FullName -Destination $alvo
        Write-Host ("   [movido {0}] {1}" -f $rotuloModulo, $arquivo.Name) -ForegroundColor Green
    } else {
        Write-Host ("   [moveria {0}] {1}  ->  {2}" -f $rotuloModulo, $arquivo.Name, (Split-Path $destino -Leaf)) -ForegroundColor Yellow
    }
    $relatorio += [pscustomobject]@{ Acao='movido'; Modulo=$rotuloModulo; Arquivo=$arquivo.Name; Destino=$destino; Origem='local' }
}

# ----------------------------------------------------------------------------------
# 5. DOWNLOAD DO QUE ESTÁ FALTANDO
# ----------------------------------------------------------------------------------

Escrever-Titulo 'ETAPA 5 - Baixando o que está faltando'

if ($SemDownload) {
    Write-Host 'Pulado (-SemDownload).' -ForegroundColor DarkGray
} elseif ($materiais.Count -eq 0) {
    Write-Host 'Nenhum material foi identificado no site — nada a baixar.' -ForegroundColor DarkGray
} else {
    foreach ($mat in ($materiais | Sort-Object Modulo, NomeArquivo)) {
        $destino = if ($pastaDoModulo.ContainsKey($mat.Modulo)) {
            $pastaDoModulo[$mat.Modulo]
        } else {
            $novo = Join-Path $Raiz (Limpar-NomeArquivo ("Módulo {0:D2}" -f $mat.Modulo))
            if ($Executar -and -not (Test-Path -LiteralPath $novo)) { New-Item -ItemType Directory -Path $novo | Out-Null }
            $pastaDoModulo[$mat.Modulo] = $novo
            $novo
        }

        $alvo = Join-Path $destino (Limpar-NomeArquivo $mat.NomeArquivo 120)

        if ((Test-Path -LiteralPath $alvo) -or $destinosPrevistos.ContainsKey($alvo)) {
            Write-Host ("   [já tem]  {0}" -f $mat.NomeArquivo) -ForegroundColor DarkGray
            $relatorio += [pscustomobject]@{ Acao='ja-existe'; Modulo=("{0:D2}" -f $mat.Modulo); Arquivo=$mat.NomeArquivo; Destino=$destino; Origem=$mat.Url }
            continue
        }

        if (-not $Executar) {
            Write-Host ("   [baixaria {0:D2}] {1}" -f $mat.Modulo, $mat.NomeArquivo) -ForegroundColor Yellow
            $relatorio += [pscustomobject]@{ Acao='baixaria'; Modulo=("{0:D2}" -f $mat.Modulo); Arquivo=$mat.NomeArquivo; Destino=$destino; Origem=$mat.Url }
            continue
        }

        try {
            if (-not (Test-Path -LiteralPath $destino)) { New-Item -ItemType Directory -Path $destino | Out-Null }
            Invoke-WebRequest -Uri $mat.Url -OutFile $alvo -UseBasicParsing -UserAgent $UserAgent -TimeoutSec 300
            Write-Host ("   [baixado {0:D2}] {1}" -f $mat.Modulo, $mat.NomeArquivo) -ForegroundColor Green
            $relatorio += [pscustomobject]@{ Acao='baixado'; Modulo=("{0:D2}" -f $mat.Modulo); Arquivo=$mat.NomeArquivo; Destino=$destino; Origem=$mat.Url }
        } catch {
            Write-Warning ("Falha ao baixar {0}: {1}" -f $mat.Url, $_.Exception.Message)
            $relatorio += [pscustomobject]@{ Acao='ERRO'; Modulo=("{0:D2}" -f $mat.Modulo); Arquivo=$mat.NomeArquivo; Destino=$destino; Origem=$mat.Url }
        }
    }
}

# ----------------------------------------------------------------------------------
# 6. RELATÓRIO
# ----------------------------------------------------------------------------------

Escrever-Titulo 'ETAPA 6 - Relatório'

$csv = Join-Path $Raiz '_RELATORIO.csv'
$md  = Join-Path $Raiz '_RELATORIO.md'

if ($Executar) {
    $relatorio | Export-Csv -LiteralPath $csv -NoTypeInformation -Encoding UTF8

    $linhas = @()
    $linhas += '# Reforma Tributária do Consumo — organização por módulo'
    $linhas += ''
    $linhas += ("Gerado em {0}" -f (Get-Date -Format 'dd/MM/yyyy HH:mm'))
    $linhas += ("Pasta: {0}" -f $Raiz)
    $linhas += ''
    foreach ($num in ($pastaDoModulo.Keys | Sort-Object)) {
        $linhas += ("## Módulo {0:D2}" -f $num)
        $itens = Get-ChildItem -LiteralPath $pastaDoModulo[$num] -File -ErrorAction SilentlyContinue
        if ($itens) { foreach ($i in $itens) { $linhas += ("- {0}" -f $i.Name) } } else { $linhas += '- (vazio)' }
        $linhas += ''
    }
    $linhas | Set-Content -LiteralPath $md -Encoding UTF8

    Write-Host "Relatórios gravados:" -ForegroundColor Green
    Write-Host "   $csv"
    Write-Host "   $md"
} else {
    Write-Host 'SIMULAÇÃO — nada foi movido nem baixado.' -ForegroundColor Yellow
    Write-Host 'Rode novamente com -Executar para aplicar de verdade.' -ForegroundColor Yellow
}

$relatorio | Group-Object Acao | Sort-Object Name | ForEach-Object {
    Write-Host ("   {0,-14} {1}" -f $_.Name, $_.Count)
}
Write-Host ''
