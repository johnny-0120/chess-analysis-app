// 全域變數
var isMuted = false; // <-- 【新】加入靜音狀態變數
var board = null;
var currentAnalysisData = []; 
var currentMoveIndex = -1;
var highlightedSquares = []; // 儲存高亮的方格
var currentBoardTheme = 'green'; // <-- 【新】預設為木紋
var currentPieceTheme = 'wikipedia'; // <-- 【新】預設為 wikipedia
// 當頁面 DOM 載入完成後執行
$(document).ready(function() {
    console.log("Document ready 已觸發。"); // Debug log

// 【新】從 localStorage 載入儲存的棋子主題
    var savedPieceTheme = localStorage.getItem('pieceTheme');
    // 確保儲存的值是我們支援的選項之一
    if (savedPieceTheme && ['wikipedia', 'Neo' /* 加入你下載的其他樣式名 */ ].includes(savedPieceTheme)) {
        currentPieceTheme = savedPieceTheme;
        $('#piece-theme-select').val(savedPieceTheme); // 設定下拉選單的值
    }
    // 不需要立刻 apply，初始化 board 時會用到

// 初始化棋盤...
    // 【修改】初始化時使用 currentPieceTheme
    board = Chessboard('myBoard', {
        position: 'start',
        draggable: false,
        // 使用變數來設定主題路徑
        pieceTheme: `img/chesspieces/${currentPieceTheme}/{piece}.png`
    });
    applyBoardTheme(currentBoardTheme); // 應用棋盤顏色
    // --- 綁定所有按鈕 ---

    // 分析按鈕
    $('#analyze-button').off('click').on('click', startAnalysis);
    console.log("「開始分析」按鈕已綁定。"); // Debug log

    // 上一手按鈕
    $('#prev-move').off('click').on('click', function() {
        console.log("上一手 clicked. Current index:", currentMoveIndex, "Target index:", currentMoveIndex - 1); // Debug
        showMove(currentMoveIndex - 1);
    });
    console.log("「上一手」按鈕已綁定。"); // Debug log

    // 下一手按鈕
    $('#next-move').off('click').on('click', function() {
        console.log("下一手 clicked. Current index:", currentMoveIndex, "Target index:", currentMoveIndex + 1); // Debug
        showMove(currentMoveIndex + 1);
    });
    console.log("「下一手」按鈕已綁定。"); // Debug log

    // 【修正】翻轉棋盤按鈕
    $('#flip-board-button').off('click').on('click', function() {
        console.log("翻轉棋盤 clicked."); // Debug log
        if (board) { // 確保 board 物件存在
             board.flip();
        } else {
             console.error("Board object is not initialized!");
        }
    });
    console.log("「翻轉棋盤」按鈕已綁定。"); // Debug log

    // 靜音按鈕
    $('#mute-toggle-button').off('click').on('click', function() {
        console.log("靜音 toggle clicked."); // Debug log
        isMuted = !isMuted;
        $('#mute-icon').attr('src', isMuted ? 'icons/volume_off.png' : 'icons/volume_on.png');
        try { if (isMuted) { document.getElementById('move-sound').pause(); document.getElementById('check-sound').pause(); } } catch(e){}
    });
    console.log("「靜音」按鈕已綁定。"); // Debug log

    // 總結區塊收合
    $('#summary-toggle').off('click').on('click', function() {
        console.log("總結 toggle clicked."); // Debug log
        var $content = $('#analysis-summary-content');
        $content.slideToggle(200);
        setTimeout(function() {
             var arrow = $content.is(':visible') ? '&#9652;' : '&#9662;';
             $('#summary-toggle').html('對局總結 (點擊展開/收合) ' + arrow);
        }, 210);
    });
    console.log("「總結區塊」標題已綁定。"); // Debug log

    // 棋步列表點擊
    $('#analysis-container').off('click', '.move-item-col').on('click', '.move-item-col', function() {
        var index = $(this).data('index');
        if (typeof index !== 'undefined' && !isNaN(parseInt(index, 10))) {
            console.log("棋步格子 clicked. Index:", index); // Debug log
            showMove(parseInt(index, 10));
        }
    });
    console.log("「棋步列表」格子已綁定。"); // Debug log

// 【新】綁定棋盤主題下拉選單的 change 事件
    $('#board-theme-select').off('change').on('change', function() {
        var selectedTheme = $(this).val(); 
        console.log("下拉選單變更！選擇的值:", selectedTheme); // <-- 加入 Log
        applyBoardTheme(selectedTheme);
    });

}); // --- $(document).ready 結束 ---


// 【新】綁定棋子樣式下拉選單的 change 事件
    $('#piece-theme-select').off('change').on('change', function() {
        var selectedPieceTheme = $(this).val();
        applyPieceTheme(selectedPieceTheme);
    });
    console.log("「棋子樣式」下拉選單已綁定。"); // Debug log

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
    $('#analysis-summary-content').hide().html(""); $('#summary-toggle').html('對局總結 (點擊展開/收合) &#9662;');
    $('#opening-name-display').html("<i>讀取開局名稱...</i>");
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
                // 【新】顯示中英文開局名稱
                var openingInfo = data.opening_name || { en: "Unknown Opening", zh: "未知開局" }; // 提供預設值
                var openingHTML = escapeHTML(openingInfo.en);
                if (openingInfo.zh && openingInfo.zh.trim() !== "") { // 如果中文名存在且不是空的
                    openingHTML += ` / ${escapeHTML(openingInfo.zh)}`;
                }
                $('#opening-name-display').html(openingHTML);

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
    // --- 1. 邊界檢查 ---
    // 確保 index 在 [-1, total_moves - 1] 的範圍內
    var minIndex = -1;
    var maxIndex = currentAnalysisData.length - 1;
    if (index < minIndex) {
        index = minIndex;
        console.log("Index adjusted to min:", index); // Debug
    }
    if (index > maxIndex) {
        index = maxIndex;
        console.log("Index adjusted to max:", index); // Debug
    }

    // 如果索引沒有真的改變 (例如已在最後一步還按下一手)，就不用做任何事
    if (index === currentMoveIndex) {
        console.log("Index did not change:", index); // Debug
        return;
    }

    // --- 2. 更新當前索引 ---
    currentMoveIndex = index;
    console.log("Showing move for index:", currentMoveIndex); // Debug

    // --- 3. 清除棋盤高亮 ---
    removeHighlights();

    // --- 4. 清除列表高亮 ---
    $('#analysis-container .move-item-col').removeClass('selected');

    // --- 5. 處理特殊情況：初始局面 (-1) ---
    if (index === -1) {
        board.position('start');
        updateWinRateDisplay(50, 50);
        // 不需要高亮列表
        // 滾動到頂部 (可選)
        $('#analysis-container').animate({ scrollTop: 0 }, 150);
        return;
    }

    // --- 6. 獲取棋步數據並更新顯示 ---
    var moveData = currentAnalysisData[index];
    if (moveData) {
        board.position(moveData.fen); // 更新棋盤

        // 播放聲音
        if (!isMuted) {
            try {
                var soundToPlay = moveData.is_check ? document.getElementById('check-sound') : document.getElementById('move-sound');
                if (soundToPlay) { soundToPlay.currentTime = 0; soundToPlay.play(); }
            } catch (e) { console.warn("無法播放聲音:", e); }
        }

        updateWinRateDisplay(moveData.win_rate_white, moveData.win_rate_black); // 更新勝率

        // 高亮對應的列表格子
        var $moveCol = $('#analysis-container .move-item-col[data-index="' + index + '"]');
        if ($moveCol.length > 0) {
            $moveCol.addClass('selected');
            // 滾動到其所在的整行
            var $movePair = $moveCol.closest('.move-pair');
            if ($movePair.length > 0) {
                scrollToMove($movePair);
            }
        }

        // 高亮棋盤上的 from/to
        if (moveData.actual_move_from) {
            highlightSquare(moveData.actual_move_from, 'highlight-actual-move');
            highlightSquare(moveData.actual_move_to, 'highlight-actual-move');
        }
        if (moveData.move_quality && (moveData.move_quality.includes("Mistake") || moveData.move_quality.includes("Blunder"))) {
            if (moveData.best_move_from && moveData.best_move_from !== "N/A") {
                highlightSquare(moveData.best_move_from, 'highlight-best-move');
                highlightSquare(moveData.best_move_to, 'highlight-best-move');
            }
        }
    } else {
         console.error("Move data not found for index:", index); // Debug
    }
}
/**
 * 輔助函式：自動滾動分析列表
 */
function scrollToMove($elementToScrollTo) {
    var $container = $('#analysis-container');
    // 再次檢查元素和位置
    if (!$elementToScrollTo || $elementToScrollTo.length === 0 || !$elementToScrollTo.position()) {
        console.warn("Scroll target not found or invalid:", $elementToScrollTo);
        return;
    }
    try { // 加入 try-catch 以防萬一
        $container.animate({
            scrollTop: $elementToScrollTo.position().top - $container.position().top + $container.scrollTop() - 40
        }, 150);
     } catch (e) {
         console.error("Error during scroll animation:", e);
     }
}

/**
 * 更新頂部的勝率顯示
 */
function updateWinRateDisplay(white, black) {
    $('#win-rate-text').html(`白方: ${white}% | 黑方: ${black}%`);
    $('#white-bar').css('width', white + '%');
}


/**
 * 【新】將後端傳來的分析結果顯示在頁面上 (兩欄式)
 */
function displayAnalysis(analysisResults) {
    var analysisContainer = $('#analysis-container');
    analysisContainer.html(""); // 清空

    if (analysisResults.length === 0) {
        analysisContainer.append("<p style='padding: 10px;'>沒有找到任何棋步。</p>");
        return;
    }

    // 使用 div 作為容器，方便套用 CSS
    var $listContainer = $("<div class='move-list-container'></div>");

    // 將分析結果按步數分組
    var movesByNumber = {};
    analysisResults.forEach(function(moveData, index) {
        if (!movesByNumber[moveData.move_number]) {
            movesByNumber[moveData.move_number] = {};
        }
        movesByNumber[moveData.move_number][moveData.color] = { ...moveData, originalIndex: index }; // 儲存原始索引
    });

    // 遍歷步數來建立每一行
    for (var moveNum in movesByNumber) {
        var whiteMove = movesByNumber[moveNum]["White"];
        var blackMove = movesByNumber[moveNum]["Black"];

        // 建立每一行的 div
        var $movePair = $("<div class='move-pair'></div>");
        // 將原始索引存儲起來，方便點擊時使用 showMove
        if (whiteMove) $movePair.data('white-index', whiteMove.originalIndex);
        if (blackMove) $movePair.data('black-index', blackMove.originalIndex);

        // 1. 步數欄
        $movePair.append(`<div class="move-number">${moveNum}.</div>`);

        // --- 輔助函式：產生單一棋步的 HTML ---
        function createMoveColHTML(moveData) {
            if (!moveData) return "<div class='move-item-col'></div>"; // 如果沒有這一步 (例如最後一步是白棋)

            var moveSanHTML = `<span class="move-san">${escapeHTML(moveData.move)}</span>`;
            var analysisDetailHTML = "";
            var itemClassSuffix = ''; // 用於添加 blunder/mistake class

            if (moveData.move_quality) {
                var quality = moveData.move_quality;
                if (quality.includes("Mistake") || quality.includes("Blunder")) {
                    itemClassSuffix = ' ' + quality.split(' ')[0].toLowerCase(); // 添加樣式 class
                    analysisDetailHTML = `<div class="analysis-detail move-col-analysis">
                                            <b>${escapeHTML(quality)}!</b> 最佳: ${escapeHTML(moveData.best_move)}
                                          </div>`;
                } else if (quality.includes("Best") || quality.includes("Excellent")) {
                    analysisDetailHTML = `<div class="analysis-detail-good move-col-analysis">
                                            <b>${escapeHTML(quality)}!</b>
                                          </div>`;
                }
            }
            // 加入原始索引到 data-* 屬性，方便點擊處理
            return `<div class='move-item-col move-item${itemClassSuffix}' data-index="${moveData.originalIndex}">
                        ${moveSanHTML}
                        ${analysisDetailHTML}
                    </div>`;
        }
        // --- 結束輔助函式 ---

        // 2. 白棋欄
        $movePair.append(createMoveColHTML(whiteMove));

        // 3. 黑棋欄
        $movePair.append(createMoveColHTML(blackMove));

        $listContainer.append($movePair);
    }

    analysisContainer.append($listContainer);
    showMove(-1); // 預設顯示初始局面
}


function displaySummary(summary) {
    var $summaryBox = $('#analysis-summary-content');
    
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
    
}


/**
 * 【新】應用棋盤顏色主題
 */
function applyBoardTheme(themeName) {
    console.log("正在執行 applyBoardTheme，主題:", themeName); // <-- 加入 Log
    var $boardElement = $('#myBoard'); 
    console.log("找到棋盤元素:", $boardElement.length > 0); // <-- 加入 Log
    // 移除所有可能的主題 class
    $boardElement.removeClass('board-theme-wood board-theme-green board-theme-blue board-theme-grey');
    // 添加選中的主題 class
    var themeClass = 'board-theme-' + themeName;
    $boardElement.addClass(themeClass);
    console.log("已添加 class:", themeClass, "棋盤現在的 class:", $boardElement.attr('class')); // <-- 加入 Log
    currentBoardTheme = themeName; 
    try { 
         localStorage.setItem('boardTheme', themeName);
    } catch (e) {
         console.warn("Could not save board theme to localStorage:", e);
    }
    // console.log("Board theme changed to:", themeName); // 這行本來就有
}


/**
 * 【新】應用棋子樣式主題 (透過重新建立棋盤)
 */
function applyPieceTheme(themeName) {
    if (!board) return; // 如果棋盤還沒初始化，就退出

    // 1. 取得目前棋盤的局面 (FEN 字串)
    var currentFen = board.fen();

    // 2. 銷毀舊的棋盤物件
    //   (注意：chessboard.js v1.0.0 的 destroy 可能不完美，
    //    但這是標準做法。如果遇到問題，可能需要手動清空 #myBoard)
    // board.destroy(); // 嘗試調用 destroy
    $('#myBoard').empty(); // 更可靠的方法：直接清空棋盤內容

    // 3. 更新全域變數
    currentPieceTheme = themeName;

    // 4. 重新初始化棋盤，使用新的 pieceTheme 和舊的局面
    board = Chessboard('myBoard', {
        position: currentFen, // 使用剛才儲存的局面
        draggable: false,
        pieceTheme: `img/chesspieces/${currentPieceTheme}/{piece}.png` // 使用新主題
    });

    // 5. 【重要】重新應用當前的棋盤顏色主題
    //    因為重新初始化會移除舊的 class
    applyBoardTheme(currentBoardTheme);

    // 6. 重新高亮當前棋步的格子 (如果有的話)
    if (currentMoveIndex >= 0) {
        // 短暫延遲，確保棋盤渲染完成
        setTimeout(function() {
             showMove(currentMoveIndex); // 重新觸發高亮和聲音
        }, 50); // 50毫秒延遲
    }


    // 7. 儲存到 localStorage
    try {
        localStorage.setItem('pieceTheme', themeName);
    } catch (e) {
        console.warn("Could not save piece theme to localStorage:", e);
    }
    console.log("Piece theme changed to:", themeName); // Debug log
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