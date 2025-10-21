// 全域變數
var board = null;
var currentAnalysisData = []; 
var currentMoveIndex = -1;
var highlightedSquares = []; // 儲存高亮的方格

// 當頁面 DOM 載入完成後執行
$(document).ready(function() {
    
    // 初始化棋盤
    board = Chessboard('myBoard', {
        position: 'start',
        draggable: false,
        pieceTheme: 'img/chesspieces/wikipedia/{piece}.png' 
    });
    
    // 綁定按鈕
    $('#analyze-button').on('click', startAnalysis);
    $('#prev-move').on('click', function() { showMove(currentMoveIndex - 1); });
    $('#next-move').on('click', function() { showMove(currentMoveIndex + 1); });
    
    $('#flip-board-button').on('click', function() {
        board.flip();
    });

    $('#analysis-container').on('click', 'li.move-item', function() {
        var index = $(this).data('index');
        showMove(index);
    });
});

/**
 * 開始分析的函數
 */
function startAnalysis() {
    var pgnText = ""; 
    var fileInput = $('#pgn-file-input')[0];
    var textInput = $('#pgn-text-input').val();
    var analysisContainer = $('#analysis-container');
    
    analysisContainer.html("<h3>分析中...</h3><p style='padding: 10px;'>正在將 PGN 發送到後端伺服器...<br>這可能需要 10-30 秒，請稍候。</p>");
    
    // 重設狀態
    board.position('start');
    updateWinRateDisplay(50, 50); 
    currentAnalysisData = [];
    currentMoveIndex = -1; 
    removeHighlights(); // 清除高亮
    $('#analysis-summary').hide().html(""); // 【新】隱藏並清空總結

    // 判斷 PGN 來源
    if (textInput && textInput.trim() !== "") {
        pgnText = textInput.trim();
        processPGN(pgnText);
    }
    else if (fileInput.files.length > 0) {
        var file = fileInput.files[0];
        var reader = new FileReader();
        
        reader.onload = function(e) {
            pgnText = e.target.result;
            processPGN(pgnText); 
        };
        
        reader.onerror = function(e) {
            analysisContainer.html("<h3>錯誤</h3><p>讀取檔案時發生錯誤。</p>"); 
        };
        
        reader.readAsText(file);
    }
    else {
        analysisContainer.html("<h3>錯誤</h3><p>請上傳 PGN 檔案或在文字框中貼上內容。</p>");
    }
}

/**
 * 將 PGN 發送到後端 (fetch)
 */
async function processPGN(pgnString) {
    var analysisContainer = $('#analysis-container');
    
    try {
        const response = await fetch('http://127.0.0.1:5000/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pgn: pgnString }) 
        });

        if (response.ok) {
            const data = await response.json();
            if (data.status === 'success') {
                currentAnalysisData = data.analysis;
                displayAnalysis(currentAnalysisData);
                displaySummary(data.summary); // 【新】呼叫函式來顯示總結
            } else {
                analysisContainer.html("<h3>後端錯誤</h3><p>" + escapeHTML(data.error) + "</p>");
            }
        } else {
            analysisContainer.html("<h3>伺服器錯誤</h3><p>HTTP 狀態碼: " + response.status + "</p>");
        }

    } catch (error) {
        analysisContainer.html("<h3>連線錯誤</h3>" + 
                             "<p>無法連線到後端伺服器 (http://127.0.0.1:5000)。</p>" +
                             "<p><b>請確認你的 `python server.py` 伺服器正在 CMD 中運行。</b></p>");
    }
}

/**
 * 高亮方格的函式
 */
function highlightSquare(square, cssClass) {
    var $square = $('#myBoard .square-' + square); 
    $square.addClass(cssClass);
    highlightedSquares.push($square);
}

function removeHighlights() {
    highlightedSquares.forEach(function($square) {
        $square.removeClass('highlight-best-move');
        $square.removeClass('highlight-actual-move');
    });
    highlightedSquares = [];
}

/**
 * 顯示特定棋步的函式
 */
function showMove(index) {
    if (index < -1) { index = -1; }
    if (index >= currentAnalysisData.length) { index = currentAnalysisData.length - 1; }
    currentMoveIndex = index;

    removeHighlights(); // 每次都先清除所有高亮

    if (index === -1) {
        board.position('start');
        updateWinRateDisplay(50, 50); 
        $('#analysis-container li.move-item').removeClass('selected');
        return;
    }

    var moveData = currentAnalysisData[index];
    if (moveData) {
        board.position(moveData.fen);
        updateWinRateDisplay(moveData.win_rate_white, moveData.win_rate_black);
        
        var $listItem = $('#analysis-container li.move-item[data-index="' + index + '"]');
        $listItem.siblings().removeClass('selected');
        $listItem.addClass('selected');
        scrollToMove($listItem);

        // 1. 永遠高亮 "實際" 走過的棋 (用藍色)
        if (moveData.actual_move_from) {
            highlightSquare(moveData.actual_move_from, 'highlight-actual-move');
            highlightSquare(moveData.actual_move_to, 'highlight-actual-move');
        }

        // 2. 只有在 "錯誤" 或 "大錯" 時，才 "額外" 高亮 "最佳" 走法 (用綠色)
        if (moveData.move_quality && (moveData.move_quality.includes("Mistake") || moveData.move_quality.includes("Blunder"))) {
            if (moveData.best_move_from && moveData.best_move_from !== "N/A") {
                highlightSquare(moveData.best_move_from, 'highlight-best-move');
                highlightSquare(moveData.best_move_to, 'highlight-best-move');
            }
        }
    }
}

/**
 * 輔助函式：自動滾動分析列表
 */
function scrollToMove($listItem) {
    var $container = $('#analysis-container');
    if (!$listItem || !$listItem.position()) return;
    $container.animate({
        scrollTop: $listItem.position().top - $container.position().top + $container.scrollTop() - 40
    }, 150); 
}

/**
 * 更新頂部的勝率顯示
 */
function updateWinRateDisplay(white, black) {
    $('#win-rate-text').html(`白方: ${white}% | 黑方: ${black}%`);
    $('#white-bar').css('width', white + '%');
}


/**
 * 【【【 這就是修正後的函式 】】】
 * 將後端傳來的分析結果顯示在頁面上
 */
function displayAnalysis(analysisResults) {
    var analysisContainer = $('#analysis-container');
    analysisContainer.html(""); 

    if (analysisResults.length === 0) {
        analysisContainer.append("<p style='padding: 10px;'>沒有找到任何棋步。</p>");
        return;
    }
    
    var $list = $("<ul></ul>").css({ 'list-style': 'none', 'padding-left': 0 });
    
    analysisResults.forEach(function(moveData, index) {
        var moveText = `${moveData.move_number}. ${moveData.color === 'White' ? '' : '...'}${moveData.move}`;
        var $analysisDetail = $("");
        
        // 【【 修正：`itemClass` 在這裡被正確定義了 】】
        var itemClass = 'move-item'; 
        
        if (moveData.move_quality) {
            var quality = moveData.move_quality;
            
            // 情況 A：是 "壞棋" (Mistake 或 Blunder)
            if (quality.includes("Mistake") || quality.includes("Blunder")) {
                // 1. 增加顏色 (這就是之前的 195 行)
                itemClass += ' ' + quality.split(' ')[0].toLowerCase(); 
                // 2. 顯示最佳走法
                $analysisDetail = $("<div class='analysis-detail'>" +
                                    `<b>${escapeHTML(quality)}!</b> 最佳走法是: ${escapeHTML(moveData.best_move)}` +
                                  "</div>");
            }
            // 情況 B：是 "好棋" (Best 或 Excellent)
            else if (quality.includes("Best") || quality.includes("Excellent")) {
                // 2. "只要" 顯示綠色文字
                $analysisDetail = $("<div class='analysis-detail-good'>" +
                                    `<b>${escapeHTML(quality)}!</b>` +
                                  "</div>");
            }
        }
        
        // (這就是之前的 196 行)
        var $listItem = $(
            `<li class="${itemClass}" data-index="${index}">` +
              "<div class='move-header'>" +
                `<b>${escapeHTML(moveText)}</b>` +
                `<span class='win-rate'> (白: ${moveData.win_rate_white}%)</span>` +
              "</div>" +
            "</li>"
        );
        
        $listItem.append($analysisDetail);
        $list.append($listItem);
    });
    
    analysisContainer.append($list);
    showMove(-1); 
}

function displaySummary(summary) {
    var $summaryBox = $('#analysis-summary');
    
    // 輔助函式：產生一個玩家的 HTML
    function createPlayerHTML(player, data) {
        var html = `<div class="summary-player-section">`;
        html += `<strong>${player}</strong> | 評分: <strong>${data.elo}</strong> (ACPL: ${data.acpl})`;
        html += `<ul>`;
        html += `<li>超級棒 (Best): ${data["Best Move"]}</li>`;
        html += `<li>很棒 (Excellent): ${data.Excellent}</li>`;
        html += `<li>正常 (Good): ${data.Good}</li>`;
        html += `<li>小錯誤 (Inaccuracy): ${data.Inaccuracy}</li>`;
        html += `<li>中錯誤 (Mistake): ${data.Mistake}</li>`;
        html += `<li>大錯誤 (Blunder): ${data.Blunder}</li>`;
        html += `</ul></div>`;
        return html;
    }

    var summaryHTML = "<h4>對局總結 (評分: 估算水準，越高越好)</h4>";
    summaryHTML += createPlayerHTML("白方", summary.White);
    summaryHTML += createPlayerHTML("黑方", summary.Black);
    
    $summaryBox.html(summaryHTML);
    $summaryBox.show(); // 顯示區塊
}

/**
 * 用於在 HTML 中安全顯示文字的輔助函數
 */
function escapeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}