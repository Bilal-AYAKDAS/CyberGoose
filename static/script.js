    $(document).ready(function() {
        //getCompFiles();       
            
    });
    var activeFileLocal;
    var activeFileServer;
    

    function updatePath(name) {
        var path = $('#filepath').val();
        $('#filepath').val(path + '\\' + name);
        getLocalFiles();
    }

    function openFolderServer(name) {
        var path = $('#serverfilepath').val();
        alert(name);
        $('#serverfilepath').val(path + '\\' + name);
        getServersFiles();
    }
    function get(name) {
        var path = $('#filepath').val();
        $('#filepath').val(path + '\\' + name);
        getLocalFiles();
    }

    function getLocalFiles()  {
        var filepath = $('#filepath').val();
        var data = JSON.stringify({filepath: filepath});
        
        $.ajax({
            type: 'POST',
            url: '/api/localfiles',
            contentType: 'application/json',
            data: data,
            success: function(response) {
                console.log('Başarılı:');
                var parsedArray = response;
                var tableBody = document.getElementById('files_tables_body');
                // Temizleme
                tableBody.innerHTML = '';
                for (var i = 0; i < parsedArray.length; i++) {
                    var newRow = tableBody.insertRow();
                    var cell1 = newRow.insertCell(0);
                    var cell2 = newRow.insertCell(1);
                    var cell3 = newRow.insertCell(2);
                    var cell4 = newRow.insertCell(3);

                    newRow.ondblclick = function() {
                        var rowIndex = this.rowIndex;
                        var clickedFile = parsedArray[rowIndex -1];
                        if (clickedFile) {
                            updatePath(clickedFile.FileName);
                        }
                    };

                    cell1.innerHTML = i + 1;
                    cell2.innerHTML = parsedArray[i].FileName;
                    cell3.innerHTML = parsedArray[i].TimeStamp;
                    cell4.innerHTML = parsedArray[i].Size;

                    newRow.onclick = function(event) {
                        // Tıklanan satırı bulalım
                        var clickedRow = event.target.parentNode;

                        // Tüm satırlardan mavi rengini kaldıralım
                        var allRows = tableBody.getElementsByTagName("tr");
                        for (var j = 0; j < allRows.length; j++) {
                            allRows[j].classList.remove("selected-row");
                        }

                        // Tıklanan satıra mavi rengini ekleyelim
                        clickedRow.classList.add("selected-row");

                        // Tıklanan satırın indeksini alalım
                        var rowIndex = clickedRow.rowIndex;

                        // Seçilen satırın değerini alalım
                        activeFileLocal = parsedArray[rowIndex - 2].FileName;

                        console.log(activeFileLocal);
                    }
                }
                
            },
            error: function(xhr, status, error) {
                console.error('Hata:', error);
            }
        });
        
    }

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

                        var tableBody = document.getElementById('server_tables_body');
                        // Temizleme
                        tableBody.innerHTML = '';

                        for (var i = 0; i < data.length; i++) {
                            var newRow = tableBody.insertRow();
                            var cell1 = newRow.insertCell(0);
                            var cell2 = newRow.insertCell(1);
                            var cell3 = newRow.insertCell(2);
                            var cell4 = newRow.insertCell(3);

                            newRow.ondblclick = function() {
                                var rowIndex = this.rowIndex;
                                var clickedFile = data[rowIndex -1];
                                if (clickedFile) {
                                    openFolderServer(clickedFile.FileName);
                                }
                            };
        
                            cell1.innerHTML = i + 1;
                            cell2.innerHTML = data[i].FileName;
                            cell3.innerHTML = data[i].TimeStamp;
                            cell4.innerHTML = data[i].Size;
        
                            newRow.onclick = function(event) {
                                // Tıklanan satırı bulalım
                                var clickedRow = event.target.parentNode;
        
                                // Tüm satırlardan mavi rengini kaldıralım
                                var allRows = tableBody.getElementsByTagName("tr");
                                for (var j = 0; j < allRows.length; j++) {
                                    allRows[j].classList.remove("selected-row");
                                }
        
                                // Tıklanan satıra mavi rengini ekleyelim
                                clickedRow.classList.add("selected-row");
        
                                // Tıklanan satırın indeksini alalım
                                var rowIndex = clickedRow.rowIndex;
        
                                // Seçilen satırın değerini alalım
                                activeFileLocal = data[rowIndex - 2].FileName;
        
                                console.log(activeFileLocal);
                            }
                        }
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

        function uploadFile()  {
            var fileName = activeFileLocal;
            var folderPath = $('#filepath').val();
             
            console.log(fileName);
            var data = JSON.stringify({folderPath: folderPath,
                                        fileName:fileName
            });
            
            $.ajax({
                type: 'POST',
                url: '/api/uploadFile',
                contentType: 'application/json',
                data: data,
                success: function(response) {
                    console.log('Başarılı:');
                                  
                },
                error: function(xhr, status, error) {
                    console.error('Hata:', error);
                }
            });
        
    }

    

        
        

    