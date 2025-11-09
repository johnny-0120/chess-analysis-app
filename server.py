import chess
import chess.engine
import chess.pgn
# import chess.polyglot # 不再需要
import io
import math
import traceback # 用於印出詳細錯誤
import os # 【新】導入 os 模組
from flask import Flask, request, jsonify
from flask_cors import CORS

# ---------------------------------------------------------------
# 設定
# ---------------------------------------------------------------
# Windows: "./stockfish.exe", macOS/Linux: "./stockfish"
# 【修改】指向 Linux 版本的 Stockfish
STOCKFISH_PATH = os.environ.get('STOCKFISH_PATH', './stockfish')
ANALYSIS_DEPTH = 15

# 【新】擴充迷你開局庫 (繁體中文 + Ply 步數)
MINI_OPENING_BOOK = {
    # 5+ Ply
    "1. e4 e5 2. Nf3 Nc6 3. Bb5": {"en": "Ruy Lopez", "zh": "西班牙開局", "ply": 5},
    "1. d4 Nf6 2. c4 e6 3. Nc3 Bb4": {"en": "Nimzo-Indian Defense", "zh": "尼姆佐-印度防禦", "ply": 5},
    "1. d4 Nf6 2. c4 g6 3. Nc3 Bg7": {"en": "King's Indian Defense", "zh": "王翼印度防禦", "ply": 5},
    "1. d4 Nf6 2. c4 e6 3. Nf3 b6": {"en": "Queen's Indian Defense", "zh": "后翼印度防禦", "ply": 5},

    # 4 Ply
    "1. d4 d5 2. c4 dxc4": {"en": "Queen's Gambit Accepted", "zh": "后翼棄兵 (接受)", "ply": 4},
    "1. d4 d5 2. c4 c6": {"en": "Queen's Gambit Declined: Slav Defense", "zh": "后翼棄兵 (斯拉夫)", "ply": 4},
    "1. d4 d5 2. c4 e6": {"en": "Queen's Gambit Declined: Orthodox Defense", "zh": "后翼棄兵 (正統)", "ply": 4},
    "1. e4 e5 2. Nf3 Nc6 3. d4": {"en": "Scotch Game", "zh": "蘇格蘭開局", "ply": 4},
    
    # 3 Ply
    "1. e4 e5 2. Nf3 Nc6": {"en": "King's Knight Opening", "zh": "王翼馬開局", "ply": 3}, # (比義大利/西班牙更通用)
    "1. e4 e5 2. Nf3": {"en": "King's Knight Opening", "zh": "王翼馬開局", "ply": 3}, # (為 3. Bc4 和 3. Bb5 兜底)
    "1. e4 e5 2. f4": {"en": "King's Gambit", "zh": "王翼棄兵", "ply": 3},

    # 2 Ply
    "1. e4 c5": {"en": "Sicilian Defense", "zh": "西西里防禦", "ply": 2},
    "1. e4 e6": {"en": "French Defense", "zh": "法蘭西防禦", "ply": 2},
    "1. e4 c6": {"en": "Caro-Kann Defense", "zh": "卡羅-卡恩防禦", "ply": 2},
    "1. e4 d5": {"en": "Scandinavian Defense", "zh": "斯堪地那維亞防禦", "ply": 2},
    "1. e4 Nf6": {"en": "Alekhine's Defense", "zh": "阿廖欣防禦", "ply": 2},
    "1. e4 g6": {"en": "Modern Defense", "zh": "現代防禦", "ply": 2},
    "1. d4 Nf6": {"en": "Indian Defense", "zh": "印度防禦", "ply": 2},
    "1. d4 f5": {"en": "Dutch Defense", "zh": "荷蘭防禦", "ply": 2},
    "1. d4 d5": {"en": "Queen's Pawn Game", "zh": "后兵開局", "ply": 2},
    "1. c4 e5": {"en": "English Opening: King's English", "zh": "英國式開局 (王翼)", "ply": 2},
    "1. c4 c5": {"en": "English Opening: Symmetrical", "zh": "英國式開局 (對稱)", "ply": 2},
    "1. Nf3 d5": {"en": "Réti Opening", "zh": "列蒂開局", "ply": 2},
    "1. f4 d5": {"en": "Bird's Opening", "zh": "伯德開局", "ply": 2},

    # 1 Ply
    "1. e4": {"en": "King's Pawn Game", "zh": "王兵開局", "ply": 1},
    "1. d4": {"en": "Queen's Pawn Game", "zh": "后兵開局", "ply": 1},
    "1. Nf3": {"en": "Réti Opening", "zh": "列蒂開局", "ply": 1},
    "1. c4": {"en": "English Opening", "zh": "英國式開局", "ply": 1},
    "1. g3": {"en": "King's Fianchetto Opening", "zh": "王翼側翼開局", "ply": 1},
    "1. f4": {"en": "Bird's Opening", "zh": "伯德開局", "ply": 1},
    
    # 預設
    "Unknown Opening": {"en": "Unknown Opening", "zh": "未知開局", "ply": 0}
}

# ---------------------------------------------------------------
# Flask 伺服器設定
# ---------------------------------------------------------------
app = Flask(__name__)
# 【修改】允許所有來源 (CORS)，在 Render 上這是必要的
CORS(app)

# ---------------------------------------------------------------
# 輔助函式：ACPL -> Elo
# ---------------------------------------------------------------
def acpl_to_elo(acpl):
    if acpl <= 0: acpl = 1
    estimated_elo = 1800 - (acpl - 70) * 10
    estimated_elo = round(max(800, min(3000, estimated_elo)))
    return estimated_elo


# ---------------------------------------------------------------
# 輔助函式：分數 -> 勝率 (這個被遺漏了！)
# ---------------------------------------------------------------
def score_to_win_rate(score_cp, is_white_turn):
    """
    將 centipawn 評分轉換為白方的勝率 (0.0 to 1.0)
    """
    # Stockfish 對於 "將死" 會給一個極大/極小值
    # 限制範圍避免數學計算溢位
    score_cp = max(min(score_cp, 2000), -2000)

    # 公式： 1 / (1 + 10^(-score_in_pawns / 4))
    win_rate_white = 1 / (1 + 10**(-score_cp / 400))

    # 函式統一回傳 "白方" 的勝率
    return win_rate_white

# ---------------------------------------------------------------
# 輔助函式：分數損失 -> 棋步品質
# ---------------------------------------------------------------

def get_move_quality(score_loss):
    if score_loss <= 10: return "Best Move"
    elif score_loss <= 30: return "Excellent"
    elif score_loss <= 70: return "Good"
    elif score_loss <= 149: return "Inaccuracy"
    elif score_loss <= 299: return "Mistake"
    else: return "Blunder"

# ---------------------------------------------------------------
# 核心分析函式 (2025/11/09 加入 "Book Move" 邏輯)
# ---------------------------------------------------------------
def analyze_pgn(pgn_text):
    engine = None
    try:
        # --- 1. 啟動 Stockfish 引擎 ---
        engine = chess.engine.SimpleEngine.popen_uci(STOCKFISH_PATH)

        # --- 2. 讀取 PGN ---
        pgn_file = io.StringIO(pgn_text)
        game = chess.pgn.read_game(pgn_file)
        if game is None:
            return {"error": "無法解析 PGN。"}

        # --- 3. 讀取或比對開局名稱 ---
        opening_name_info = None
        matched_opening_ply = 0 # 【新】開局庫的步數 (ply)
        opening_header = game.headers.get("Opening")
        
        if opening_header:
            opening_name_info = {"en": opening_header, "zh": "", "ply": 0}
            # 嘗試從我們的庫中比對 ply
            for prefix_key, prefix_info in MINI_OPENING_BOOK.items():
                if opening_header.startswith(prefix_info["en"]):
                    opening_name_info = prefix_info
                    matched_opening_ply = prefix_info.get('ply', 0)
                    break
        else:
            try:
                temp_board_for_opening = game.board()
                mainline_moves = list(game.mainline_moves())
                pgn_prefix = ""
                move_count = 0
                
                # (我們最多只比對前 10 ply)
                for i, move in enumerate(mainline_moves[:10]):
                    move_num = (i // 2) + 1
                    is_white = (i % 2 == 0)
                    san_move = temp_board_for_opening.san(move)
                    if is_white: pgn_prefix += f"{move_num}. {san_move} "
                    else: pgn_prefix += f"{san_move} "
                    temp_board_for_opening.push(move)
                    
                    # 檢查是否有匹配
                    current_prefix_key = pgn_prefix.strip()
                    if current_prefix_key in MINI_OPENING_BOOK:
                         # 找到一個匹配，但繼續看是否有更長的匹配
                        opening_name_info = MINI_OPENING_BOOK[current_prefix_key]
                        matched_opening_ply = opening_name_info.get('ply', 0)

            except Exception as e:
                print(f"辨識開局時發生錯誤: {e}")
                traceback.print_exc()

        if not opening_name_info:
            opening_name_info = MINI_OPENING_BOOK["Unknown Opening"]
            matched_opening_ply = 0

        # --- 4. 初始化分析結果和總結 ---
        analysis_results = []
        board = game.board() # 主分析棋盤
        
        # 【修改】在 summary 中加入 "Book Move"
        summary = {
            "White": {"Book Move": 0, "Best Move": 0, "Excellent": 0, "Good": 0, "Inaccuracy": 0, "Mistake": 0, "Blunder": 0, "total_loss": 0, "move_count": 0, "acpl": 0, "elo": 0},
            "Black": {"Book Move": 0, "Best Move": 0, "Excellent": 0, "Good": 0, "Inaccuracy": 0, "Mistake": 0, "Blunder": 0, "total_loss": 0, "move_count": 0, "acpl": 0, "elo": 0}
        }
        print("引擎啟動成功，開始分析棋局...")
        print(f"辨識開局: {opening_name_info['en']} (前 {matched_opening_ply} ply 為開局庫棋步)")

        # --- 5. 遍歷 PGN 中的每一步棋 ---
        move_number = 1
        is_white_move = True
        
        # 獲取初始分數
        try:
            initial_info = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
            if initial_info and "score" in initial_info:
                last_score_cp = initial_info["score"].white().score(mate_score=30000)
            else: last_score_cp = 20
        except Exception as init_err:
            print(f"無法獲取初始分數: {init_err}")
            last_score_cp = 20

        # 【修改】使用 enumerate 獲取索引 (i)
        for i, move in enumerate(game.mainline_moves()):
            
            is_check_after_move = False
            
            # 【新】檢查是否為開局庫棋步
            is_book_move = (i < matched_opening_ply) # i 是 0-based index

            # --- 5a. 獲取 "實際" 走法的座標和 SAN ---
            actual_move_from = chess.square_name(move.from_square)
            actual_move_to = chess.square_name(move.to_square)
            move_san = board.san(move)

            if is_book_move:
                # --- 5b. (開局庫棋步邏輯) ---
                move_quality = "Book Move"
                score_loss = 0
                best_move_san = move_san # 開局庫棋步被視為最佳
                best_move_from = actual_move_from
                best_move_to = actual_move_to
                best_score_cp = last_score_cp # 假設分數沒有損失
            
            else:
                # --- 5b. (正常分析邏輯) ---
                info_before = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
                best_move_san, best_move_from, best_move_to = "N/A", "N/A", "N/A"
                best_score_cp = last_score_cp # 預設
                
                if info_before and "score" in info_before:
                    best_score_cp = info_before["score"].white().score(mate_score=30000)
                    best_move_object = info_before.get("pv", [None])[0]
                    if best_move_object:
                        try:
                            best_move_san = board.san(best_move_object)
                            best_move_from = chess.square_name(best_move_object.from_square)
                            best_move_to = chess.square_name(best_move_object.to_square)
                        except Exception as san_err:
                            print(f"警告：無法生成最佳走法的 SAN: {san_err}")

            # --- 5c. 實際走 PGN 中的那一步棋 ---
            board.push(move)

            # --- 5d. 在 push 之後計算 is_check ---
            is_check_after_move = board.is_check()

            # --- 5e. 分析新局面 (所有棋步都需要) ---
            # (我們需要這個來更新勝率條和下一輪的 last_score_cp)
            info_after = engine.analyse(board, chess.engine.Limit(depth=ANALYSIS_DEPTH))
            current_score_cp = best_score_cp # 預設
            if info_after and "score" in info_after:
                 current_score_cp = info_after["score"].white().score(mate_score=30000)

            # --- 5f. 計算分數損失 & 品質 (如果不是開局庫棋步) ---
            if not is_book_move:
                score_loss = 0
                if abs(best_score_cp) < 29000 and abs(current_score_cp) < 29000:
                    if is_white_move: score_loss = best_score_cp - current_score_cp
                    else: score_loss = current_score_cp - best_score_cp
                move_quality = get_move_quality(max(0, score_loss))
            
            # --- 5g. 更新總結數據 ---
            player = "White" if is_white_move else "Black"
            # (Book Move 不計入 ACPL，所以只在非 Book Move 時更新總結)
            if not is_book_move:
                summary[player]["move_count"] += 1
                if score_loss > 0:
                     summary[player]["total_loss"] += score_loss
                if move_quality:
                     summary[player][move_quality] += 1
            else:
                # 即使是 Book Move，也要在計數器中顯示
                summary[player]["Book Move"] += 1

            # --- 5h. 計算勝率 ---
            win_rate_white = score_to_win_rate(current_score_cp, not is_white_move)
            win_rate_black = 1.0 - win_rate_white

            # --- 5i. 儲存結果 ---
            analysis_results.append({
                "move_number": move_number, "color": player, "move": move_san,
                "fen": board.fen(), "score_cp": current_score_cp,
                "win_rate_white": round(win_rate_white * 100, 1),
                "win_rate_black": round(win_rate_black * 100, 1),
                "move_quality": move_quality, "best_move": best_move_san,
                "best_move_from": best_move_from, "best_move_to": best_move_to,
                "actual_move_from": actual_move_from, "actual_move_to": actual_move_to,
                "is_check": is_check_after_move
            })

            # --- 5j. 更新下一步資訊 ---
            if not is_white_move: move_number += 1
            is_white_move = not is_white_move
            last_score_cp = current_score_cp

    except Exception as e:
        print("!!!!!! 分析 PGN 過程中發生錯誤 !!!!!!")
        traceback.print_exc()
        if engine:
            engine.quit() # 確保出錯時也關閉引擎
        return None # 分析失敗

    # --- 6. 計算 ACPL 和 Elo (finally 區塊外) ---
    if summary["White"]["move_count"] > 0: # move_count 只計算非 Book Move
        summary["White"]["acpl"] = round(summary["White"]["total_loss"] / summary["White"]["move_count"])
    if summary["Black"]["move_count"] > 0:
        summary["Black"]["acpl"] = round(summary["Black"]["total_loss"] / summary["Black"]["move_count"])
    summary["White"]["elo"] = acpl_to_elo(summary["White"]["acpl"])
    summary["Black"]["elo"] = acpl_to_elo(summary["Black"]["acpl"])

    # --- 7. 關閉引擎 ---
    if engine:
        engine.quit()
        print("分析完成，引擎已關閉。")

    # --- 8. 返回結果 ---
    return {"status": "success", "analysis": analysis_results, "summary": summary, "opening_name": opening_name_info}
    
# ---------------------------------------------------------------
# API 路由 (Endpoint) - 【修正】加入對 analyze_pgn 返回 None 的處理
# ---------------------------------------------------------------
@app.route("/analyze", methods=["POST"])
def handle_analysis():
    print("後端伺服器：收到了分析請求！")
    data = request.json
    if not data or "pgn" not in data:
        return jsonify({"error": "沒有 PGN 資料"}), 400

    pgn_string = data["pgn"]
    print(f"--- 收到的 PGN (前150字): {pgn_string[:150]} ...")

    results = analyze_pgn(pgn_string)

    # 【新】處理 analyze_pgn 可能返回 None (啟動或分析失敗) 或 {"error": ...} (PGN解析失敗)
    if results is None:
        return jsonify({"error": "後端分析時發生嚴重錯誤，請檢查終端機日誌。"}), 500 # 500 Internal Server Error
    elif "error" in results:
        return jsonify(results), 400 # 400 Bad Request (例如 PGN 無法解析)

    print("後端伺服器：分析完成，正在回傳結果。")
    return jsonify(results) # 200 OK

# ---------------------------------------------------------------
# 【修改】啟動伺服器的方式
# ---------------------------------------------------------------
if __name__ == "__main__":
    # 這是為了讓 Render.com 這種平台能正常運作
    # 它們會動態指定 PORT
    port = int(os.environ.get("PORT", 5000))
    # '0.0.0.0' 表示監聽所有網路介面，而不只是 '127.0.0.1'
    app.run(debug=False, host="0.0.0.0", port=port)