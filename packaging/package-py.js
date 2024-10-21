
module.exports = function(grunt) {
    var files = grunt.file.expand(this.data.src);

    var output = ""
    for(var i in files) {
        var f = grunt.file.read(files[i]);
        f = f.replace(/\r\n?/g, "\n");

        output += "Sk.builtinFiles.files['" + files[i].replace(/^.*runtime\/client\/py\//, "src/lib/") + "']=";
        output += JSON.stringify(f);
        output += ";"

    }

    grunt.file.write(this.data.dest, output, {encoding: "UTF-8"});
};
