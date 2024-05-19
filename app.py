from flask import Flask,url_for, jsonify, redirect, request,render_template
from google.oauth2 import service_account
from flask_cors import CORS
import os_folder as mycomp
from ftpconn import FTPOperations
from sftpconn import SFTPOperations
from db import DbMyFtp
from dropboxIslemleri import DropboxOperations
import string

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
    if request.method == 'POST':
        if request.headers['Content-Type'] == 'application/json':
            data = request.json
            conn_type = data.get('conn_type')
            username = data.get('username')
            server = data.get('server')
            port = data.get('port')
            passwd = data.get('passwd')
            sshkey = data.get('sshkey')
            global serverConn
            if username and server and port and passwd or sshkey:
                if conn_type == "FTP":
                    try:
                        serverConn = FTPOperations(server, int(port), username, passwd)
                    except Exception as e:
                        print(e)
                        return jsonify({'error': 'var'})
                elif conn_type == "SFTP":
                    try:
                        serverConn = SFTPOperations(server, int(port), username, passwd)
                    except Exception as e:
                        print(e)
                        return jsonify({'error': 'var'})
                elif conn_type == "DropBox":
                    serverConn = DropboxOperations()
                    pass
                    return jsonify({'error': 'var'})
                    
                return jsonify({'Bağlantı': 'Başarılı'})
            else:
                return jsonify({'Bağlantı': 'Parametreleri Eksik'})
        else:
            return jsonify({'error': 'İçerik tipi "application/json" değil'})

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

#################################################################
#DROPBOX
#################################################################





if __name__ == '__main__':
    app.run(host='127.0.0.1', port=5502,debug=True)
