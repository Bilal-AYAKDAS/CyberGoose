    $(document).ready(function() {
        getCompFiles();
    });
    
    function serverConnFunc() {
        var formURL = "serverconnection.html";
        var win = window.open(formURL, "_blank", "resizable=yes,width=600,height=600");
        if (!win) {
            alert("Popup engellendi. Lütfen popupları etkinleştirin.");
        }
    }

        function getServersFiles() {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/dirlist', true);
            xhr.onreadystatechange = function() {
                if (xhr.readyState == 4) {
                    if (xhr.status == 200) {
                        console.log(xhr.responseText);
                        var data = JSON.parse(xhr.responseText);
                        var table = '<table class="table table-striped table-hover"><tr><th>Sıra</th><th>Dosya Adı</th><th>Değişim Zamanı</th><th>Boyut</th></tr>';
                        for (var i = 0; i < data.length; i++) {
                            table += '<tr><td>' + (i+1) + '</td><td>' + data[i].FileName + '</td><td>' + data[i].TimeStamp + '</td><td>' + data[i].Size + '</td></tr>';
                        }
                        table += '</table>';
                        document.getElementById('dosya_tablosu').innerHTML = table;
                    } else {
                        console.error('Hata:', xhr.statusText);
                    }
                }
            };
            xhr.onerror = function() {
                console.error('Hata:', xhr.statusText);
            };
            xhr.send();
        }

        function getCompFiles() {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', '/api/compdirs', true);
            xhr.onreadystatechange = function() {
                if (xhr.readyState == 4) {
                    if (xhr.status == 200) {
                        console.log(xhr.responseText);
                        var data = JSON.parse(xhr.responseText);
                        var table = '<table class="table table-striped table-hover" id="comp-table"><tr><th>Sıra</th><th>Dosya Adı</th><th>Zaman Damgası</th><th>Boyut</th></tr>';
                        for (var i = 0; i < data.length; i++) {
                            table += '<tr><td>' + (i+1) + '</td><td>' + data[i].FileName + '</td><td>' + data[i].TimeStamp + '</td><td>' + data[i].Size + '</td></tr>';
                        }
                        table += '</table>';
                        document.getElementById('mypc_files').innerHTML = table;
                    } else {
                        console.error('Hata:', xhr.statusText);
                    }
                }
            };
            xhr.onerror = function() {
                console.error('Hata:', xhr.statusText);
            };
            xhr.send();
        }
        
        
        

    