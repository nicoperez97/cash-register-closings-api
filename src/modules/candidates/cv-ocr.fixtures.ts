/**
 * Fixture OCR típico de CV 2 columnas (sidebar + cuerpo).
 * Mezcla realista: a veces OCR lee por filas intercalando columnas.
 */
export const victoriaTempestaOcrColumnWise = `
Tempesta, Victoria
DNI: 47.215.519

PERFIL
Estudiante de Biología orientación Zoología, Facultad de Ciencias Naturales y Museo, Universidad Nacional de La Plata

DATOS PERSONALES
Fecha de nacimiento: 23/02/2006
Lugar de nacimiento: La Plata, Buenos Aires, Argentina

CONTACTO
+54 9 221 627-2185
vitempesta9@gmail.com
La Plata, Buenos Aires, Argentina

EXPERIENCIA PROFESIONAL
-Laboratorio MAG | Laboratorio de Microbiologia Industrial
Calle 22 N°47 esq. 33, La Plata
Producción de medios de cultivo para control de procesos microbianos en agua, y embalaje para despacho. Manejo administrativo de Excel para conteo de cultivos y pedidos de clientes.
Contacto: Gariboglio, Andrea (+54 9 221 628-0494).

EDUCACIÓN
2018-2023
La Plata, Buenos Aires. Estudios Secundarios, Colegio San Jose de La Plata.

2024-Actualidad
La Plata, Buenos Aires. Licenciatura en Biología, orientación Zoología. Universidad Nacional de La Plata. Estado: cursando 3er año.

2012-2023
La Plata, Buenos Aires. Estudios extra curriculares de ingles y preparación para First Certificate Exame Cambridge. Colegio San Jose de La Plata.

IDIOMAS
Español: nativo
Inglés: avanzado (C1)
`.trim();

/** OCR por filas: mezcla sidebar con columna derecha (peor caso). */
export const victoriaTempestaOcrInterleaved = `
Tempesta, Victoria EXPERIENCIA PROFESIONAL
DNI: 47.215.519 -Laboratorio MAG | Laboratorio de Microbiologia Industrial
PERFIL Calle 22 N°47 esq. 33, La Plata
Estudiante de Biología orientación Zoología, Facultad de Ciencias Naturales y Museo, Universidad Nacional de La Plata
Producción de medios de cultivo para control de procesos microbianos en agua, y embalaje para despacho. Manejo administrativo de Excel para conteo de cultivos y pedidos de clientes.
DATOS PERSONALES Contacto: Gariboglio, Andrea (+54 9 221 628-0494).
Fecha de nacimiento: 23/02/2006 EDUCACIÓN
Lugar de nacimiento: La Plata, Buenos Aires, Argentina 2018-2023
CONTACTO La Plata, Buenos Aires. Estudios Secundarios, Colegio San Jose de La Plata.
+54 9 221 627-2185 2024-Actualidad
vitempesta9@gmail.com La Plata, Buenos Aires. Licenciatura en Biología, orientación Zoología. Universidad Nacional de La Plata. Estado: cursando 3er año.
La Plata, Buenos Aires, Argentina 2012-2023
La Plata, Buenos Aires. Estudios extra curriculares de ingles y preparación para First Certificate Exame Cambridge. Colegio San Jose de La Plata.
IDIOMAS
Español: nativo
Inglés: avanzado (C1)
`.trim();
