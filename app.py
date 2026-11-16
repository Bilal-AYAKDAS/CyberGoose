from flask import Flask,url_for, jsonify, redirect, request,render_template
from flask_cors import CORS
import os_folder as mycomp
from ftpconn import FTPOperations
from sftpconn import SFTPOperations
from db import DbMyFtp
from dropboxIslemleri import DropboxOperations
from drive_conn import DriveService
import string
from config import FLASK_DEBUG, FLASK_HOST, FLASK_PORT

app = Flask(__name__)
CORS(app)  # Tüm kaynaklardan gelen isteklere izin verir

servers_dirs = dict()
serverConn = None
db = DbMyFtp()

@app.route('/')
def index():
    return open('template/index.html', encoding='utf-8').read()

@app.route('/serverconnection.html')
def serverconnection():
    return open('template/serverconnection.html', encoding='utf-8').read()

@app.route('/bookmarks.html')
def openbookmarks():
    return open('template/bookmarks.html', encoding='utf-8').read()

@app.route('/file_inf.html')
def openFileInfo():
    return open('template/file_inf.html', encoding='utf-8').read()

@app.route('/api/fileinfo', methods=['POST'])
def file_info():
    global serverConn
    data = request.json
    filepath = data.get('filepath')
    print("geldim")
    print(filepath)
    if not filepath:
        return jsonify({"error": "Filepath is required"}), 400
    file_info = serverConn.get_file_details(filepath)
    return jsonify(file_info)

@app.route('/api/localfileinfo', methods=['POST'])
def local_file_info():
    data = request.get_json(silent=True) or {}
    filepath = data.get('filepath')
    if not filepath:
        return jsonify({"error": "Filepath is required"}), 400
    try:
        return jsonify(mycomp.inspect_file(filepath))
    except FileNotFoundError:
        return jsonify({"error": "File not found"}), 404
    except IsADirectoryError:
        return jsonify({"error": "Path is a directory"}), 400
    except OSError:
        app.logger.exception("Unable to inspect local file")
        return jsonify({"error": "Unable to inspect local file"}), 500

@app.route('/api/localfilepreview', methods=['POST'])
def local_file_preview():
    data = request.get_json(silent=True) or {}
    filepath = data.get('filepath')
    if not filepath:
        return jsonify({"error": "Filepath is required"}), 400
    try:
        inspection = mycomp.inspect_file(filepath)
        return jsonify({
            "FileName": inspection["FileName"],
            "FilePath": inspection["FilePath"],
            "preview": inspection["preview"],
            "previewTruncated": inspection["previewTruncated"],
        })
    except FileNotFoundError:
        return jsonify({"error": "File not found"}), 404
    except IsADirectoryError:
        return jsonify({"error": "Path is a directory"}), 400
    except OSError:
        app.logger.exception("Unable to preview local file")
        return jsonify({"error": "Unable to preview local file"}), 500

@app.route('/api/fileUpdate', methods=['POST'])
def filemodechange():
    if request.method == 'POST':
        if request.headers['Content-Type'] == 'application/json':
            data = request.json
            filepath = data.get('filepath')
            filemod = data.get('filemod')
            global serverConn
            serverConn.change_file_mode(filepath, filemod)         
            return jsonify({'ISLEM': 'BASARILI'})
    else:
        return jsonify({'error': 'İçerik tipi "application/json" değil'})

@app.route('/submit', methods=['POST'])
def submit():
    """Bağlantı kurar.

    Başarı: 200 {'Bağlantı': 'Başarılı'}.
    Hata durumları artık HTTP durum koduyla döner (önceden hepsi 200'dü ve arayüz
    başarısız bağlantıyı başarılı sanıyordu):
      415 JSON değil · 400 eksik/geçersiz parametre veya desteklenmeyen tür · 502 sağlayıcıya bağlanılamadı.
    """
    global serverConn
    if not request.is_json:
        return jsonify({'error': 'İçerik tipi "application/json" olmalı'}), 415

    data = request.get_json(silent=True) or {}
    conn_type = str(data.get('conn_type') or '').strip()
    username = data.get('username')
    server = data.get('server')
    port = data.get('port')
    passwd = data.get('passwd')
    normalized = conn_type.lower()

    if normalized == 'dropbox':
        try:
            connection = DropboxOperations()
        except Exception:
            app.logger.exception("Dropbox bağlantısı kurulamadı")
            return jsonify({'error': 'Dropbox bağlantısı kurulamadı'}), 502
        if not connection.access_token:
            return jsonify({'error': 'Dropbox erişim izni alınamadı'}), 502
        serverConn = connection
        return jsonify({'Bağlantı': 'Başarılı'})

    if normalized == 'googledrive':
        try:
            serverConn = DriveService()
        except Exception:
            app.logger.exception("Drive bağlantısı kurulamadı")
            return jsonify({'error': 'Google Drive bağlantısı kurulamadı'}), 502
        return jsonify({'Bağlantı': 'Başarılı'})

    if normalized not in ('ftp', 'sftp'):
        return jsonify({'error': f'Desteklenmeyen bağlantı türü: {conn_type or "-"}'}), 400

    if not (username and server and port and passwd):
        return jsonify({'error': 'Sunucu, port, kullanıcı adı ve parola gerekli'}), 400
    try:
        port_number = int(port)
    except (TypeError, ValueError):
        return jsonify({'error': 'Port sayı olmalı'}), 400
    if not 1 <= port_number <= 65535:
        return jsonify({'error': 'Port 1-65535 arasında olmalı'}), 400

    try:
        if normalized == 'ftp':
            connection = FTPOperations(server, port_number, username, passwd)
        else:
            connection = SFTPOperations(server, port_number, username, passwd)
    except Exception:
        app.logger.exception("%s bağlantısı kurulamadı", conn_type)
        return jsonify({'error': f'{server} bağlantısı kurulamadı'}), 502
    # SFTPOperations kimlik doğrulama hatalarını yutar ve `sftp` oturumu açmadan döner.
    if normalized == 'sftp' and getattr(connection, 'sftp', None) is None:
        return jsonify({'error': f'{server} bağlantısı kurulamadı. Kullanıcı adı ve parolayı kontrol edin.'}), 502
    serverConn = connection
    return jsonify({'Bağlantı': 'Başarılı'})

@app.route('/api/compdirs', methods=['GET'])
def getCompDirList():
    mycompDirlists = mycomp.list_files("C:\\Users\\bilalayakdas\\Desktop\\FtpDirectory")
    return jsonify(mycompDirlists)

@app.route('/api/serverfilelist', methods=['POST'])
def getDirs():
    data = request.json
    path = data.get('path')
    if path == None:
        path = "/"
    global serverConn
    global servers_dirs

    if serverConn is None:
        return jsonify({"error": "Sunucu bağlantısı kurulmadı"}), 500
    
    servers_dirs = serverConn.open_folder(path)
    return jsonify(servers_dirs)

@app.route('/api/localfiles', methods=['POST'])
def localfiles():
    if request.method == 'POST':
        if request.headers['Content-Type'] == 'application/json':
            data = request.json
            filepath = data.get('filepath')
            mycompDirlists = mycomp.list_files(str(filepath))
    return jsonify(mycompDirlists)
    
@app.route('/api/uploadFile', methods=['POST'])
def uploadFile():
    try:
        print("uploadFile")
        # JSON içeriğini alalım
        data = request.json
        folderPath = data.get('folderPath')
        fileName = data.get('fileName')
        serverpath = data.get('serverpath')
        serverpath = serverpath +"/"+ fileName
        print(folderPath)
        print(fileName)
        global serverConn
        print(serverpath)
        serverConn.dosya_yukle(serverpath,folderPath.replace("\\","/")+"/"+fileName)
        return jsonify("uploadFile: OK")
    except Exception as e:
        print(e)
        return jsonify("uploadFile: Error")
    
@app.route('/api/downloadFile', methods=['POST'])
def downloadFile():
    try:
        data = request.json
        folderPath = data.get('folderPath')
        fileName = data.get('fileName')
        serverpath = data.get('serverpath')
        serverpath = serverpath +"/"+ fileName
        print(folderPath)
        print(fileName)
        global serverConn
        print(serverpath)
        serverConn.dosya_indir(serverpath,folderPath.replace("\\","/")+"/"+fileName)
        return jsonify("DownoladFile: OK")
    except Exception as e:
        print(e)
        return jsonify("DownoladFile: Error")
    
@app.route('/api/deleteFileFromServer', methods=['POST'])
def deleteFileFromServer():
    try:
        data = request.json
        fileName = data.get('fileName')
        serverpath = data.get('serverpath')
        serverpath = serverpath +"/"+ fileName
        print(fileName)
        global serverConn
        print(serverpath)
        serverConn.dosya_sil(serverpath)
        print("DeleteFile: OK")
        return jsonify("DeleteFile: OK")
    except Exception as e:
        print(e)
        return jsonify("DeleteFile: Error")
        
@app.route('/api/deleteFileFromLocal', methods=['POST'])
def deleteFileFromLocal():
    try:
        data = request.json
        fileName = data.get('fileName')
        folderPath = data.get('folderPath')
        print(fileName)
        print(folderPath)
        mycomp.delete_file(folderPath+"/"+fileName)
        print("DeleteFile: OK")
        return jsonify("DeleteFile: OK")
    except Exception as e:
        print(e)
        return jsonify("DeleteFile: Error")

@app.route('/api/bookmark', methods=['GET'])
def get_bookmark():
    bookmark_data = db.selectBookMarks()
    if bookmark_data:
        return jsonify(bookmark_data)
    else:
        return jsonify({"error": "No data found"}), 404

@app.route('/api/localBookmark', methods=['GET'])
def get_localbookmark():
    bookmark_data = db.selectLocalBookMarks()
    if bookmark_data:
        return jsonify(bookmark_data)
    else:
        return jsonify({"error": "No data found"}), 404

@app.route('/api/getBookmarksList', methods=['GET'])
def get_allbookmark():
    bookmark_data = db.selectAllBookMarks()
    if bookmark_data:
        return jsonify(bookmark_data)
    else:
        return jsonify({"error": "No data found"}), 404

@app.route('/api/saveBookmark', methods=['POST'])
def save_bookmark():
    if request.method == 'POST':
        if request.headers['Content-Type'] == 'application/json':
            data = request.json
            conn_name = data.get('CONNECTION_NAME') 
            conn_type = data.get('CONNECTION_TYPE')
            server = data.get('HOSTNAME')
            port = data.get('PORT')
            username = data.get('USERNAME')
            passwd = data.get('PASSWORD')
            sshkey = data.get('SSHKEY', None)  # SSH key optional
            db.insertBookMarks(conn_name,conn_type, username, server, port, passwd)
            return jsonify({'CEVAP': 'Kayıt başarılı'})

        else:
            return jsonify({'error': 'Parametreler eksik veya yanlış'})
    else:
        return jsonify({'error': 'İçerik tipi "application/json" değil'})

@app.route('/api/deleteBookmark', methods=['POST'])
def delete_bookmark():
    if request.method == 'POST':
        if request.headers['Content-Type'] == 'application/json':
            data = request.json
            id = data.get('id')
            db.deleteBookMarks(id)
            return jsonify({'CEVAP': 'SİLİNDİ'})

        else:
            return jsonify({'error': 'Parametreler eksik veya yanlış'})
    else:
        return jsonify({'error': 'İçerik tipi "application/json" değil'})

if __name__ == '__main__':
    app.run(host=FLASK_HOST, port=FLASK_PORT, debug=FLASK_DEBUG)
